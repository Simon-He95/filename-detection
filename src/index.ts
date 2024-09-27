import { basename, resolve } from 'node:path'
import { nextTick } from 'node:process'
import fs from 'node:fs'
import { addEventListener, createFakeProgress, createInput, createSelect, getConfiguration, getLocale, message, rename } from '@vscode-use/utils'
import type { Disposable, ExtensionContext } from 'vscode'
import { Uri } from 'vscode'
import fg from 'fast-glob'
import { camelize, isContainCn } from 'lazy-js-utils'
import translateLoader from '@simon_he/translate'

const Typo = require('typo-js')

export async function activate(context: ExtensionContext) {
  const disposes: Disposable[] = []
  const lan = getLocale()
  const isZh = lan.includes('zh')
  const zero_character_reg = /\p{Cf}/gu
  const dictionary = new Typo('en_US')
  const isCheck = getConfiguration('filename-detection.cSpell') as boolean
  const fixedNameFunc = async (files: any, isEdit = true) => {
    const suggestions = []
    const warningMsgs: string[] = [
      '🚨 文件或目录名中可能存在拼写错误：',
    ]
    const errorNamesCache = new Set()
    // const isOneFile = files.length === 1
    for (const file of files) {
      const newUri = isEdit ? file.newUri : file
      let ext = basename(newUri.fsPath)
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

            if (zero_character_reg.test(value))
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
          fs.unlink(newUri.fsPath, (err) => {
            if (err) {
              message.error(err.message)
            }
          })
          return
        }
        const exactValue = newName ? newName + suffix : ext
        ext = exactValue
        const newUrl = Uri.file((resolve(newUri.fsPath, '..', exactValue)))
        nextTick(() => {
          rename(newUri, newUrl)
        })
      }
      const fixedName = ext.replace(/\s/g, '').replace(zero_character_reg, '')
      if (/\s/.test(ext)) {
        message.error({
          message: `${ext} ${isZh ? '命名中存在空格,是否自动修复删除空格？' : 'If there is a space in the name, will the space be automatically repaired and deleted?'}`,
          buttons: isZh ? '修复' : 'Repair',
        }).then(async (v) => {
          if (v) {
            rename(newUri, Uri.file(newUri.fsPath.replace(ext, fixedName)))
              .then(() => {
                message.info(`${isZh ? '已将文件名' : 'The file name has been'}：[${ext}] -> [${fixedName}]`)
              })
          }
        })
        return
      }
      else if (zero_character_reg.test(ext)) {
        message.error({
          message: `${ext} ${isZh ? '命名中存在零宽字符,是否自动修复删除空格？' : 'There are zero-width characters in the name, does it automatically repair and delete spaces?'}`,
          buttons: isZh ? '修复' : 'Repair',
        }).then(async (v) => {
          if (v) {
            rename(newUri, Uri.file(newUri.fsPath.replace(ext, fixedName)))
              .then(() => {
                message.info(`${isZh ? '已将文件名' : 'The file name has been'}：[${ext}] -> [${fixedName}]`)
              })
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
          const exts = (await chineseToEnglish(ext))[0].split(' ').map(item => item.toLocaleLowerCase())
          resolver(true)
          // 提供驼峰和hyphen的选择
          const newExtName = await getNewExtName(exts)
          if (newExtName) {
            rename(newUri, Uri.file(newUri.fsPath.replace(ext, newExtName)))
              .then(() => {
                message.info(`${isZh ? '已将文件名' : 'The file name has been'}：[${ext}] -> [${newExtName}]`)
              })
          }
        }
        catch (error) {
          rejector(String(error))
        }

        return
      }

      const splitNames = fixedName.split('.')
      const prefixNames = splitNames[0].includes('-')
        ? splitNames[0].split('-')
        : splitNames[0].split('_')
      const userWords = (getConfiguration('cSpell.userWords') || []) as string[]
      const words = (getConfiguration('cSpell.words') || []) as string[]
      if (!isCheck)
        return
      const errorNames = prefixNames
        .filter(p => !dictionary.check(p) && !userWords.includes(p) && !words.includes(p) && ![...errorNamesCache].includes(p))
      if (!errorNames.length)
        return

      errorNames.forEach(n => errorNamesCache.add(n))
      // 读取 cSpell.userWords 和 cSpell.words
      errorNames.forEach((p) => {
        const array_of_suggestions = dictionary.suggest(p)
          .filter((s: string) => !p.toLocaleLowerCase().includes(s.toLocaleLowerCase()))
        suggestions.push(...array_of_suggestions)
        warningMsgs.push(`💡 ${p} 建议修正为：${array_of_suggestions.join(', ')}`)
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
    return name
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
