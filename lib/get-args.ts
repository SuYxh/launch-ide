import path from "path";
import { Platform, Editor } from "./type";
import { COMMON_EDITOR_PROCESS_MAP } from "./editor-info";

interface GetEditorFormatParams {
  editorBasename: string;
  openWindowParams?: string; // 在新窗口打开还是复用已有窗口
  workspace?: string | null;
}

// 格式化占位符常量
const FormatFile = "{file}";
const FormatLine = "{line}";
const FormatColumn = "{column}";

/**
 * 根据格式规则格式化文件路径和位置信息
 * @param file 文件路径
 * @param line 行号
 * @param column 列号
 * @param format 格式化规则
 * @returns 格式化后的参数数组
 */
export function formatOpenPath(
  file: string,
  line: string | number,
  column: string | number,
  format: string | string[] | boolean
) {
  // 默认格式：file:line:column
  let path = `${file}:${line}:${column}`;

  // 如果是字符串格式，替换占位符
  if (typeof format === "string") {
    path = format
      .replace(FormatFile, file)
      .replace(FormatLine, line.toString())
      .replace(FormatColumn, column.toString());
  } else if (format instanceof Array) {
    // 如果是数组格式，对数组中每个元素进行替换
    return format.map((item) => {
      return item
        .replace(FormatFile, file)
        .replace(FormatLine, line.toString())
        .replace(FormatColumn, column.toString());
    });
  }
  return [path];
}

/**
 * 获取启动编辑器所需的命令行参数
 * @param params 参数对象
 *   - processName: 编辑器进程名称（如 'code', 'sublime', 'vim' 等）
 *   - fileName: 要打开的文件路径
 *   - lineNumber: 光标定位行号
 *   - colNumber: 光标定位列号
 *   - workspace: 工作空间路径（可选）
 *   - openWindowParams: 窗口打开方式（'-r': 复用窗口, '-n': 新窗口）
 *   - pathFormat: 自定义路径格式化规则（可选）
 * @returns 格式化后的命令行参数数组
 *
 * @example
 * VSCode 示例
 * getArguments({
 *   processName: 'code',
 *   fileName: '/path/to/file.js',
 *   lineNumber: 10,
 *   colNumber: 5,
 *   workspace: '/path/to/workspace',
 *   openWindowParams: '-r'
 * })
 * 返回: ['/path/to/workspace', '-g', '-r', '/path/to/file.js:10:5']
 *
 * Vim 示例
 * getArguments({
 *   processName: 'vim',
 *   fileName: '/path/to/file.js',
 *   lineNumber: 10,
 *   colNumber: 5
 * })
 * 返回: ['+call cursor(10, 5)', '/path/to/file.js']
 */
// 入口函数：获取打开 IDE 所需要的参数
export function getArguments(params: {
  processName: string;
  fileName: string;
  lineNumber: string | number;
  colNumber: string | number;
  workspace: string | null;
  openWindowParams: string;
  pathFormat?: string | string[];
}): string[] {
  const {
    processName,
    fileName,
    lineNumber,
    colNumber,
    workspace,
    openWindowParams,
    pathFormat,
  } = params;

  // 获取编辑器的基础名称（去除扩展名）
  const editorBasename = getEditorBasenameByProcessName(processName);
  const _params = { editorBasename, openWindowParams, workspace };

  // 获取编辑器特定的格式化规则
  const format = getFormatByEditor(_params) || "{file}";

  // 根据格式规则构建最终的命令行参数， 根据 format 替换具体参数
  /**
   * 不同编辑器的参数格式示例：
   *
   * VSCode:
   * code -g /path/to/file.js:10:5
   *
   * Sublime:
   * subl /path/to/file.js:10:5
   *
   * Vim:
   * vim +call cursor(10, 5) /path/to/file.js
   *
   * Notepad++:
   * notepad++ -n10 -c5 /path/to/file.js
   *
   * IntelliJ:
   * idea --line 10 /path/to/file.js
   */
  return formatOpenPath(fileName, lineNumber, colNumber, pathFormat || format);
}

// 根据进程名获取 editor 的 basename
/**
 * 从进程名称中获取编辑器的基础名称
 *
 * 这个方法的主要作用是：
 * 1、标准化不同平台的编辑器进程名称
 * 2、支持多种编辑器的别名和变体
 * 3、处理不同操作系统的路径格式
 * 4、提供统一的编辑器标识符
 *
 * 处理流程：
 * 1. 移除路径，只保留文件名
 * 2. 移除扩展名（.exe, .cmd, .bat, .sh）
 * 3. 匹配已知编辑器映射表
 * 4. 返回标准化的编辑器名称
 *
 * @param processName 进程名称（可能是完整路径）
 * @returns 标准化的编辑器基础名称
 *
 * @example
 * Windows 示例
 * getEditorBasenameByProcessName('C:\\Program Files\\Microsoft VS Code\\code.exe')
 * 返回: 'code'
 *
 * macOS 示例
 * getEditorBasenameByProcessName('/Applications/Visual Studio Code.app/Contents/MacOS/Electron')
 * 返回: 'code'
 *
 * Linux 示例
 * getEditorBasenameByProcessName('/usr/bin/code')
 * 返回: 'code'
 */
function getEditorBasenameByProcessName(processName: string) {
  // 1. 首先获取文件名，并移除可执行文件扩展名
  let editorBasename = path
    .basename(processName)
    .replace(/\.(exe|cmd|bat|sh)$/i, "");
  // 2. 获取当前平台
  const platform = process.platform as Platform;
  // 3. 获取当前平台支持的所有编辑器基础名称
  const editorBasenames = Object.keys(COMMON_EDITOR_PROCESS_MAP[platform]);
  // 4. 遍历所有已知编辑器，尝试匹配进程名
  for (let i = 0; i < editorBasenames.length; i++) {
    // 获取当前编辑器的所有可能的进程路径
    const editorPaths =
      COMMON_EDITOR_PROCESS_MAP[platform][editorBasenames[i] as Editor] || [];
    // 检查进程名是否匹配任何已知的编辑器路径
    if (editorPaths.some((editorPath) => processName.endsWith(editorPath))) {
      editorBasename = editorBasenames[i];
      break;
    }
  }
  // 5.(标准化处理)返回小写的编辑器名称
  return editorBasename.toLowerCase();
}

// 已知 editor，返回对应 format
/**
 * 获取特定编辑器的命令行参数格式
 *
 * @param params 参数对象
 *   - editorBasename: 编辑器基础名称
 *   - openWindowParams: 窗口打开方式参数（-r: 复用窗口, -n: 新窗口）
 *   - workspace: 工作空间路径
 * @returns 格式化规则（字符串数组或字符串）
 *
 * 支持的格式占位符：
 * - {file}: 文件路径
 * - {line}: 行号
 * - {column}: 列号
 *
 * @example
 * VSCode
 * getFormatByEditor({ editorBasename: 'code', openWindowParams: '-r', workspace: '/project' })
 * 返回: ['/project', '-g', '-r', '{file}:{line}:{column}']
 *
 * Vim
 * getFormatByEditor({ editorBasename: 'vim' })
 * 返回: ['+call cursor({line}, {column})', '{file}']
 */
function getFormatByEditor(params: GetEditorFormatParams) {
  const { editorBasename, openWindowParams, workspace } = params;

  switch (editorBasename) {
    // 1. 基础格式编辑器：使用 file:line:column 格式
    case "atom":
    case "atom beta":
    case "subl":
    case "sublime":
    case "sublime_text":
    case "wstorm":
    case "charm":
    case "zed":
      return `${FormatFile}:${FormatLine}:${FormatColumn}`;
    // 2. Notepad++ 特殊格式
    case "notepad++":
      return ["-n" + FormatLine, "-c" + FormatColumn, FormatFile];
    // 3. Vim 系列编辑器格式
    case "vim":
    case "mvim":
      return [`+call cursor(${FormatLine}, ${FormatColumn})`, FormatFile];
    case "joe":
    case "gvim":
      return ["+" + FormatLine, FormatFile];
    // 4. Emacs 系列格式
    case "emacs":
    case "emacsclient":
      return ["+" + FormatLine + ":" + FormatColumn, FormatFile];
    // 5. TextMate 系列格式
    case "rmate":
    case "mate":
    case "mine":
      return ["--line", FormatLine, FormatFile];
    // 6. VSCode 系列格式
    case "code":
    case "code-insiders":
    case "code - insiders":
    case "codium":
    case "cursor":
    case "windsurf":
    case "vscodium":
    case "hbuilderx":
    case "hbuilder":
      return [
        ...(workspace ? [workspace] : []),
        "-g",
        ...(openWindowParams ? [openWindowParams] : []),
        `${FormatFile}:${FormatLine}:${FormatColumn}`,
      ];
    // 7. JetBrains 系列 IDE 格式
    case "appcode":
    case "clion":
    case "clion64":
    case "idea":
    case "idea64":
    case "phpstorm":
    case "phpstorm64":
    case "pycharm":
    case "pycharm64":
    case "rubymine":
    case "rubymine64":
    case "webstorm":
    case "webstorm64":
    case "goland":
    case "goland64":
    case "rider":
    case "rider64":
      return [
        ...(workspace ? [workspace] : []), // 可选的工作空间
        "--line", // 行号参数
        FormatLine, // 行号
        FormatFile, // 文件路径
      ];
  }
  // 如果没有匹配的编辑器，返回空字符串
  return "";
}
