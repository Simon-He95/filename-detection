import { basename } from 'node:path'
import { addEventListener, getLocale, message } from '@vscode-use/utils'
import type { Disposable, ExtensionContext } from 'vscode'
import { Uri, workspace } from 'vscode'

export async function activate(context: ExtensionContext) {
  const disposes: Disposable[] = []
  const lan = getLocale()
  const isZh = lan.includes('zh')
  const zero_character_reg = /\p{Cf}/gu
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
      }
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
