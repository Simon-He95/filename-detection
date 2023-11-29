import { basename } from 'node:path'
import { addEventListener, getLocale, message } from '@vscode-use/utils'
import type { Disposable, ExtensionContext } from 'vscode'
import { Uri, workspace } from 'vscode'

export async function activate(context: ExtensionContext) {
  const disposes: Disposable[] = []
  const lan = getLocale()
  const isZh = lan.includes('zh')

  const fixedNameFunc = (files: any) => {
    files.forEach((file: any) => {
      const { newUri } = file
      const ext = basename(newUri.fsPath)
      if (/\s/.test(ext)) {
        message.error({
          message: `${ext} ${isZh ? '命名中存在空格,是否自动修复删除空格？' : 'If there is a space in the name, will the space be automatically repaired and deleted?'}`,
          buttons: isZh ? '修复' : 'Repair',
        }).then(async (v) => {
          if (v) {
            const fixedName = ext.replace(/\s/g, '')
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
    fixedNameFunc(files)
  }))

  context.subscriptions.push(...disposes)
}

export function deactivate() {

}
