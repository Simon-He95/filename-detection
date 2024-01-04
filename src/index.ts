import { basename } from 'node:path'
import { addEventListener, getConfiguration, getLocale, message } from '@vscode-use/utils'
import type { Disposable, ExtensionContext } from 'vscode'
import { Uri, workspace } from 'vscode'

const Typo = require('typo-js')

export async function activate(context: ExtensionContext) {
  const disposes: Disposable[] = []
  const lan = getLocale()
  const isZh = lan.includes('zh')
  const zero_character_reg = /\p{Cf}/gu
  const dictionary = new Typo('en_US')
  const isCheck = getConfiguration('filename-detection.cSpell') as boolean
  const fixedNameFunc = (files: any, isEdit = true) => {
    files.forEach((file: any) => {
      const newUri = isEdit ? file.newUri : file
      const ext = basename(newUri.fsPath)
      // 如果新增的文件名是复制另一个文件带有copy时候先不做检测，待重命名后检测
      if (ext.includes(' copy'))
        return
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
      const errorNames = prefixNames.filter(p => !dictionary.check(p) && !userWords.includes(p) && !words.includes(p))
      if (!errorNames.length)
        return

      // 读取 cSpell.userWords 和 cSpell.words

      Promise.resolve().then(() => {
        const warningMsgs: string[] = [
          '🚨 文件或目录名中可能存在拼写错误：',
        ]
        errorNames.forEach((p) => {
          const array_of_suggestions = dictionary.suggest(p)
          warningMsgs.push(`💡 ${p} 建议修正为：${array_of_suggestions.join(', ')}`)
        })
        message.error({ modal: true, message: warningMsgs.join('\n'), buttons: [] })
      })
    })
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
