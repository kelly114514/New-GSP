import type { FilePlatform } from '../model/editorController';
import { openGspFile } from './openGsp';
import { chooseGspSavePath, writeGspFile } from './saveGsp';

/** 桌面版文件平台。放弃/取消的确认交给界面（应用内对话框），不额外申请原生消息框权限。 */
export function createFilePlatform(confirmDiscard: (fileName: string) => Promise<boolean>): FilePlatform {
  return {
    openGsp: openGspFile,
    chooseSavePath: chooseGspSavePath,
    writeGsp: writeGspFile,
    confirmDiscard,
  };
}
