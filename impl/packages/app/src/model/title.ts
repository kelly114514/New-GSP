/** 窗口标题：有未保存修改时附带提示。 */
export function windowTitleFor(fileName: string | null, dirty: boolean): string {
  if (fileName === null) return 'GSP-plus';
  return dirty ? `GSP-plus - ${fileName}（有未保存修改）` : `GSP-plus - ${fileName}`;
}
