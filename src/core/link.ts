/** 旧课件内置帮助的本地主题。源 URL 仍按原格式保存。 */
const helpTopics = new Map([
  ['elementsfldr/documentsfldr/doctools.htm',
    '文档里的工具\n\n每份课件可以保存自己的自定义工具。打开课件后，工具箱末尾的菜单会列出当前文档的工具。“工具选项”可查看、复制或删除文档里的工具。'],
  ['toolboxfldr/customtoolsfldr/usingcustomtool.htm',
    '使用自定义工具\n\n从工具箱末尾的菜单选择一个工具。按状态栏提示依次点选它要求的对象。需要自由点时，可以点空白处。按 Esc 退出当前工具。'],
  ['toolboxfldr/customtoolsfldr/toolfolder.htm',
    '工具文件夹\n\n打开工具箱末尾的菜单，选择“选择工具文件夹…”，指向存有工具课件的文件夹。加载后可按课件名称找到这些工具。'],
  ['menufldr/editmenufldr/splitmergefldr/mergingtext.htm',
    '合并文本\n\n用箭头选择说明及要合并的对象，在“编辑”菜单查看当前选择允许的合并命令。要让文字随某个点移动，使用“合并文本到点”。'],
  ['advtopicsfldr/advtextfldr/mergetxttopt.htm',
    '合并文本到点\n\n选定点和要附着的说明，按住 Shift 打开“编辑”菜单，再执行“合并文本到点”。拖动该点可以检查文字是否跟随。'],
  ['advtopicsfldr/advtextfldr/mergetxtcusttmplt.htm',
    '把附着文字做成工具\n\n先将需要复用的说明附着到点。选中点及附着的说明，再在自定义工具菜单中创建工具。使用新工具时选择另一个点，就可以复用该文字构造。'],
]);

export function legacyHelpTopic(url: string): string | undefined {
  return /^help:\/\//i.test(url) ? helpTopics.get(url.slice(7).toLowerCase()) : undefined;
}

export function isExternalActionUrl(url: string): boolean {
  return /^https?:\/\/[^\s"<>]+$/i.test(url) ||
    /^mailto:[a-z0-9._+-]+@[a-z0-9.-]+$/i.test(url);
}
