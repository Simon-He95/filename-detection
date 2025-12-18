import type { Disposable, ExtensionContext } from 'vscode'
import fs from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { nextTick } from 'node:process'
import translateLoader from '@simon_he/translate'
import { addEventListener, createFakeProgress, createInput, createSelect, getConfiguration, getLocale, message, rename } from '@vscode-use/utils'
import fg from 'fast-glob'
import { camelize, isContainCn } from 'lazy-js-utils'
import { Uri } from 'vscode'

// eslint-disable-next-line perfectionist/sort-imports
const Typo = require('typo-js')

export async function activate(context: ExtensionContext) {
  const disposes: Disposable[] = []
  const lan = getLocale()
  const isZh = lan.includes('zh')
  const t = (zh: string, en: string) => isZh ? zh : en
  // NOTE: global regex + `.test()` is stateful; use a non-global regex for tests.
  const zero_character_reg = /\p{Cf}/gu
  const zero_character_test_reg = /\p{Cf}/u

  let dictionary: any | undefined
  const getDictionary = () => (dictionary ||= new Typo('en_US'))

  const normalizeName = (name: string) => name.replace(/\s/g, '').replace(zero_character_reg, '')
  const splitStemAndSuffix = (name: string) => {
    const dotIndex = name.lastIndexOf('.')
    if (dotIndex <= 0 || dotIndex === name.length - 1)
      return { stem: name, suffix: '' }

    return {
      stem: name.slice(0, dotIndex),
      suffix: name.slice(dotIndex),
    }
  }

  const fixedNameFunc = async (files: any, isEdit = true) => {
    const suggestions: string[] = []
    const warningMsgs: string[] = [t('🚨 文件或目录名中可能存在拼写错误：', '🚨 Potential spelling mistakes in file/folder name:')]
    const errorNamesCache = new Set<string>()
    const isCheck = getConfiguration('filename-detection.cSpell') === true
    // const isOneFile = files.length === 1
    for (const file of files) {
      const newUri = isEdit ? file.newUri : file
      let ext = basename(newUri.fsPath)
      const dirPath = dirname(newUri.fsPath)

      // 定义fixedName变量以确保在所有代码路径中都可用
      let fixedName = normalizeName(ext)

      const renameInSameDir = async (nextBaseName: string) => {
        const nextUri = Uri.file(join(dirPath, nextBaseName))
        await rename(newUri, nextUri)
      }

      // 检测是否需要处理父目录路径
      const checkPathSegments = () => {
        // 如果basename没有需要转换的问题，检查父路径是否有问题
        if (!isContainCn(ext) && !zero_character_test_reg.test(ext) && !(/\s/.test(ext))) {
          // 当前文件所在目录名
          const currentDirName = basename(dirPath)
          if (currentDirName && (isContainCn(currentDirName) || zero_character_test_reg.test(currentDirName) || /\s/.test(currentDirName))) {
            // 创建当前目录的URI对象
            const parentUri = Uri.file(dirPath)

            // 直接处理父目录，无需用户点击
            if (isContainCn(currentDirName)) {
              // 处理中文目录名
              handleChineseDirectory(parentUri, currentDirName)
            }
            else if (zero_character_test_reg.test(currentDirName)) {
              // 处理带零宽字符的目录名
              handleZeroWidthDirectory(parentUri, currentDirName)
            }
            else if (/\s/.test(currentDirName)) {
              // 处理带空格的目录名
              handleSpaceDirectory(parentUri, currentDirName)
            }
          }
        }
      }

      // 处理中文目录名的函数
      async function handleChineseDirectory(uri: Uri, dirName: string) {
        let resolver!: (value: unknown) => void
        let rejector!: (msg: string) => void
        createFakeProgress({
          title: '正在翻译中文目录名',
          callback(resolve, _reject) {
            resolver = resolve
            rejector = _reject
          },
          message: increment => `当前进度 ${increment}%`,
        })
        try {
          const exts = (await chineseToEnglish(dirName))[0].split(' ').map(item => item.toLocaleLowerCase())
          resolver(true)
          // 提供驼峰和hyphen的选择
          const newDirName = await getNewExtName(exts)
          if (newDirName) {
            const newPath = Uri.file(join(dirname(uri.fsPath), newDirName))

            try {
              await rename(uri, newPath)
              message.info(`${isZh ? '已将目录名' : 'The directory name has been'}：[${dirName}] -> [${newDirName}]`)
            }
            catch (error) {
              message.error(`${isZh ? '重命名目录失败' : 'Failed to rename directory'}: ${String(error)}`)
            }
          }
        }
        catch (error) {
          rejector(String(error))
        }
      }

      // 处理带零宽字符的目录名
      function handleZeroWidthDirectory(uri: Uri, dirName: string) {
        const fixedDirName = dirName.replace(zero_character_reg, '')
        message.error({
          message: `${dirName} ${isZh ? '目录名中存在零宽字符,是否自动修复？' : 'There are zero-width characters in the directory name, auto fix?'}`,
          buttons: isZh ? '修复' : 'Repair',
        }).then(async (v) => {
          if (v) {
            const newPath = Uri.file(join(dirname(uri.fsPath), fixedDirName))

            try {
              await rename(uri, newPath)
              message.info(`${isZh ? '已将目录名' : 'The directory name has been'}：[${dirName}] -> [${fixedDirName}]`)
            }
            catch (error) {
              message.error(`${isZh ? '重命名目录失败' : 'Failed to rename directory'}: ${String(error)}`)
            }
          }
        })
      }

      // 处理带空格的目录名
      function handleSpaceDirectory(uri: Uri, dirName: string) {
        const fixedDirName = dirName.replace(/\s/g, '')
        message.error({
          message: `${dirName} ${isZh ? '目录名中存在空格,是否自动修复删除空格？' : 'There are spaces in the directory name, auto fix?'}`,
          buttons: isZh ? '修复' : 'Repair',
        }).then(async (v) => {
          if (v) {
            const newPath = Uri.file(join(dirname(uri.fsPath), fixedDirName))

            try {
              await rename(uri, newPath)
              message.info(`${isZh ? '已将目录名' : 'The directory name has been'}：[${dirName}] -> [${fixedDirName}]`)
            }
            catch (error) {
              message.error(`${isZh ? '重命名目录失败' : 'Failed to rename directory'}: ${String(error)}`)
            }
          }
        })
      }

      // 如果新增的文件名是复制另一个文件带有copy时候先不做检测，直接弹出修改文件名的输入选项
      if (ext.includes(' copy')) {
        // 读取当前目录下的所有文件名
        const entry = (await fg(['./*', './*.*'], { cwd: resolve(newUri.fsPath, '..') })).filter(e => e !== ext)
        const suffix = ext.includes('.') ? `.${ext.split('.').slice(-1)[0]}` : ''
        const value = ext.replace(/ copy.*/, '').replace(new RegExp(`\\${suffix}$`), '')
        let newName = await createInput({
          title: `输入修改文件名(${suffix || ''})`,
          placeHolder: '请输入修改文件名',
          value,
          prompt: value,
          validate(value) {
            if (!value)
              return '文件名不能为空'

            if (/\s/.test(value))
              return '文件名不能包含空格'

            if (zero_character_test_reg.test(value))
              return '文件名不能包含零宽字符'

            if (entry.includes(value + suffix))
              return '文件名冲突'
            return null
          },
        })
        // 如果输入的名字是中文，则转换为英文，并提供几种组合选择
        if (newName) {
          if (isContainCn(newName)) {
            let resolver!: (value: unknown) => void
            let rejector!: (msg: string) => void
            createFakeProgress({
              title: '正在翻译中文文件名',
              callback(resolve, _reject) {
                resolver = resolve
                rejector = _reject
              },
              message: increment => `当前进度 ${increment}%`,
            })
            try {
              const exts = (await chineseToEnglish(newName))[0].split(' ').map(item => item.toLocaleLowerCase())
              resolver(true)
              // 提供驼峰和hyphen的选择
              newName = await getNewExtName(exts)
            }
            catch (error) {
              rejector(JSON.stringify(error))
            }
          }
        }
        else {
          // 如果取消了，直接删掉 copy 文件
          // 可能文件被用户删除了,判断文件是否存在
          if (!fs.existsSync(newUri.fsPath)) {
            return
          }
          fs.unlink(newUri.fsPath, (err) => {
            if (err) {
              message.error(err.message)
            }
          })
          return
        }
        const exactValue = newName ? newName + suffix : ext
        ext = exactValue
        // 更新fixedName以确保拼写检查能正确工作
        fixedName = normalizeName(ext)
        const newUrl = Uri.file(join(dirPath, exactValue))
        nextTick(() => {
          rename(newUri, newUrl)
        })
      }
      else {
        if (/\s/.test(ext)) {
          message.error({
            message: `${ext} ${t('命名中存在空格,是否自动修复删除空格？', 'There are spaces in the name, auto fix (remove spaces)?')}`,
            buttons: isZh ? '修复' : 'Repair',
          }).then(async (v) => {
            if (v) {
              try {
                await renameInSameDir(fixedName)
                message.info(`${isZh ? '已将文件名' : 'The file name has been'}：[${ext}] -> [${fixedName}]`)
              }
              catch (error) {
                message.error(`${t('重命名文件失败', 'Failed to rename file')}: ${String(error)}`)
              }
            }
          })
          return
        }
        else if (zero_character_test_reg.test(ext)) {
          message.error({
            message: `${ext} ${t('命名中存在零宽字符,是否自动修复删除零宽字符？', 'There are zero-width characters in the name, auto fix (remove zero-width characters)?')}`,
            buttons: isZh ? '修复' : 'Repair',
          }).then(async (v) => {
            if (v) {
              try {
                await renameInSameDir(fixedName)
                message.info(`${isZh ? '已将文件名' : 'The file name has been'}：[${ext}] -> [${fixedName}]`)
              }
              catch (error) {
                message.error(`${t('重命名文件失败', 'Failed to rename file')}: ${String(error)}`)
              }
            }
          })
          return
        }
        else if (isContainCn(ext)) {
          let resolver!: (value: unknown) => void
          let rejector!: (msg: string) => void
          createFakeProgress({
            title: '正在翻译中文文件名',
            callback(resolve, _reject) {
              resolver = resolve
              rejector = _reject
            },
            message: increment => `当前进度 ${increment}%`,
          })
          try {
            const { stem, suffix } = splitStemAndSuffix(ext)
            const exts = (await chineseToEnglish(stem))[0].split(' ').map(item => item.toLocaleLowerCase())
            resolver(true)
            // 提供驼峰和hyphen的选择
            const newExtName = await getNewExtName(exts)
            if (newExtName) {
              const nextBaseName = `${newExtName}${suffix}`
              try {
                await renameInSameDir(nextBaseName)
                message.info(`${isZh ? '已将文件名' : 'The file name has been'}：[${ext}] -> [${nextBaseName}]`)
              }
              catch (error) {
                message.error(`${t('重命名文件失败', 'Failed to rename file')}: ${String(error)}`)
              }
            }
          }
          catch (error) {
            rejector(String(error))
          }

          return
        }
        else {
          // 如果当前basename没有问题，检查父目录
          checkPathSegments()
        }
      }

      const splitNames = fixedName.split('.')
      const prefixNames = splitNames[0].split(/[-_]+/).filter(Boolean)
      const userWords = (getConfiguration('cSpell.userWords') || []) as string[]
      const words = (getConfiguration('cSpell.words') || []) as string[]
      if (!isCheck)
        continue
      const dictionary = getDictionary()
      const errorNames = prefixNames
        .filter(p => !dictionary.check(p) && !userWords.includes(p) && !words.includes(p) && !errorNamesCache.has(p))
      if (!errorNames.length)
        continue

      errorNames.forEach(n => errorNamesCache.add(n))
      // 读取 cSpell.userWords 和 cSpell.words
      errorNames.forEach((p) => {
        const array_of_suggestions = dictionary.suggest(p)
          .filter((s: string) => !p.toLocaleLowerCase().includes(s.toLocaleLowerCase()))
        suggestions.push(...array_of_suggestions)
        warningMsgs.push(t(
          `💡 ${p} 建议修正为：${array_of_suggestions.join(', ')}`,
          `💡 ${p} suggestions: ${array_of_suggestions.join(', ')}`,
        ))
      })
    }

    if (suggestions.length)
      message.warn({ modal: true, message: warningMsgs.join('\n'), buttons: [] })
  }
  disposes.push(addEventListener('rename', ({ files }) => {
    fixedNameFunc(files)
  }))
  disposes.push(addEventListener('file-create', ({ files }) => {
    fixedNameFunc(files, false)
  }))

  context.subscriptions.push(...disposes)
}

export function deactivate() {

}
const translate = translateLoader()

async function chineseToEnglish(name: string) {
  // 如果输入的名字是中文，则转换为英文，并提供几种组合选择
  if (!isContainCn(name)) {
    return [name]
  }
  return await translate(name, 'en')
}

async function getNewExtName(exts: string[]) {
  const hyphenExtName = exts.join('-')
  const lowHyphenExtName = exts.join('_')
  const camelExtName = camelize(hyphenExtName)
  const bigCamelExtName = camelExtName[0].toLocaleUpperCase() + camelExtName.slice(1)
  const selectOptions = [...new Set([
    hyphenExtName,
    lowHyphenExtName,
    camelExtName,
    bigCamelExtName,
  ])]

  return selectOptions.length > 1
    ? await createSelect(selectOptions, {
        title: '请选择需要的命名',
      })
    : selectOptions[0]
}
