import { basename, resolve } from 'node:path'
import { nextTick } from 'node:process'
import { addEventListener, createInput, getConfiguration, getLocale, message, rename } from '@vscode-use/utils'
import type { Disposable, ExtensionContext } from 'vscode'
import { Uri, workspace } from 'vscode'
import fg from 'fast-glob'

const Typo = require('typo-js')

export async function activate(context: ExtensionContext) {
  const disposes: Disposable[] = []
  const lan = getLocale()
  const isZh = lan.includes('zh')
  const zero_character_reg = /\p{Cf}/gu
  const dictionary = new Typo('en_US')
  const isCheck = getConfiguration('filename-detection.cSpell') as boolean
  const fixedNameFunc = (files: any, isEdit = true) => {
    const suggestions = []
    const warningMsgs: string[] = [
      '🚨 文件或目录名中可能存在拼写错误：',
    ]
    const errorNamesCache = new Set()
    files.forEach(async (file: any) => {
      const newUri = isEdit ? file.newUri : file
      const ext = basename(newUri.fsPath)
      // 如果新增的文件名是复制另一个文件带有copy时候先不做检测，直接弹出修改文件名的输入选项
      if (ext.includes(' copy')) {
        // 读取当前目录下的所有文件名
        const entry = (await fg(['./*', './*.*'], { cwd: resolve(newUri.fsPath, '..') })).filter(e => e !== ext)

        return createInput({
          title: '输入修改文件名',
          placeHolder: '请输入修改文件名',
          value: '',
          prompt: ext.replace(/ copy[^.]*/, ''),
          validate(value) {
            if (!value)
              return '文件名不能为空'

            if (/\s/.test(value))
              return '文件名不能包含空格'

            if (zero_character_reg.test(value))
              return '文件名不能包含零宽字符'

            if (entry.includes(value))
              return '文件名冲突'
            return null
          },
        }).then((newName: any) => {
          const newUrl = Uri.file((resolve(newUri.fsPath, '..', newName)))
          nextTick(() => {
            rename(newUri, newUrl)
          })
        })
      }
      const fixedName = ext.replace(/\s/g, '').replace(zero_character_reg, '')
      if (/\s/.test(ext)) {
        message.error({
          message: `${ext} ${isZh ? '命名中存在空格,是否自动修复删除空格？' : 'If there is a space in the name, will the space be automatically repaired and deleted?'}`,
          buttons: isZh ? '修复' : 'Repair',
        }).then(async (v) => {
          if (v) {
            workspace.fs.rename(newUri, Uri.file(newUri.fsPath.replace(ext, fixedName)))
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
            workspace.fs.rename(newUri, Uri.file(newUri.fsPath.replace(ext, fixedName)))
              .then(() => {
                message.info(`${isZh ? '已将文件名' : 'The file name has been'}：[${ext}] -> [${fixedName}]`)
              })
          }
        })
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
    })
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
