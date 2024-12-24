/**
 * 这个文件的主要工作流程是：
 * 1、通过 launchIDE 函数接收打开文件的相关参数
 * 2、使用 guessEditor 推测或获取配置的编辑器
 * 3、处理文件路径（特别是在 WSL 环境下）
 * 4、根据不同的编辑器和操作系统构建启动命令
 * 5、使用 child_process 启动编辑器进程
 * 6、处理可能出现的错误并提供反馈
 * 
 * 特别的处理包括：
 * 1、Windows 系统下的特殊字符转义
 * 2、WSL 环境下的路径转换
 * 3、终端编辑器的进程管理
 * 4、支持多种 IDE 打开方式（复用或新建窗口）
 * 5、环境变量配置的读取和解析
这个工具库的主要用途是在开发工具中集成"点击打开源代码"的功能，比如在开发调试工具中点击错误堆栈，直接在 IDE 中打开对应的源代码位置。
 */

import fs from "fs";
import path from "path";
import child_process from "child_process";
import os from "os";
import chalk from "chalk";
import dotenv from "dotenv";
import { Editor, IDEOpenMethod } from "./type";
import { getArguments } from "./get-args";
import { guessEditor } from "./guess";

/**
 * 判断是否为终端编辑器（如 vim、emacs、nano）
 * @param editor 编辑器名称
 * @returns boolean
 */
function isTerminalEditor(editor: string) {
  switch (editor) {
    case "vim":
    case "emacs":
    case "nano":
      return true;
  }
  return false;
}

/**
 * 获取环境变量中配置的路径格式化规则
 * 支持两种配置来源：
 * 1. webpack 环境变量：process.env.CODE_INSPECTOR_FORMAT_PATH
 * 2. .env.local 文件中的 CODE_INSPECTOR_FORMAT_PATH
 *
 * 配置示例：
 * CODE_INSPECTOR_FORMAT_PATH='["^/home/user/project", "C:/Project"]'
 * 表示将 /home/user/project 开头的路径替换为 C:/Project
 *
 * @returns {Array<string>|null} 返回解析后的路径格式化规则数组，解析失败则返回 null
 */
function getEnvFormatPath() {
  // webpack
  // 1. 尝试从 webpack 环境变量中获取配置
  if (process.env.CODE_INSPECTOR_FORMAT_PATH) {
    try {
      return JSON.parse(process.env.CODE_INSPECTOR_FORMAT_PATH);
    } catch (error) {
      return null;
    }
  }

  // vite
  // 2. 尝试从 .env.local 文件中获取配置
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    // 读取并解析 .env.local 文件
    const envFile = fs.readFileSync(envPath, "utf-8");
    const envConfig = dotenv.parse(envFile || "");

    // 如果存在路径格式化配置
    if (envConfig.CODE_INSPECTOR_FORMAT_PATH) {
      try {
        return JSON.parse(envConfig.CODE_INSPECTOR_FORMAT_PATH);
      } catch (error) {
        return null;
      }
    }
  }

  // 如果没有找到任何配置或配置无效，返回 null
  return null;
}

/**
 * 打印配置说明信息
 * 当打开编辑器失败时，输出帮助信息指导用户如何正确配置
 * @param fileName 文件名
 * @param errorMessage 错误信息
 */
function printInstructions(fileName: any, errorMessage: string | any[] | null) {
  console.log(
    chalk.red("Could not open " + path.basename(fileName) + " in the editor.")
  );
  if (errorMessage) {
    if (errorMessage[errorMessage.length - 1] !== ".") {
      errorMessage += ".";
    }
    console.log(
      chalk.red("The editor process exited with an error: " + errorMessage)
    );
  }
  console.log(
    "To set up the editor integration, add something like " +
      chalk.cyan("CODE_EDITOR=code") +
      " to the " +
      chalk.green(".env.local") +
      " file in your project folder," +
      " or add " +
      chalk.green('editor: "code"') +
      " to CodeInspectorPlugin config, " +
      "and then restart the development server. Learn more: " +
      chalk.green("https://goo.gl/MMTaZt")
  );
}

let _childProcess:
  | {
      kill: (arg0: string) => void;
      on: (
        arg0: string,
        arg1: { (errorCode: any): void; (error: any): void }
      ) => void;
    }
  | any
  | null = null;

/**
 * 获取打开窗口的参数
 * @param ideOpenMethod 打开方式：'reuse' - 复用窗口, 'new' - 新窗口
 * @returns 对应的命令行参数
 */
function getOpenWindowParams(ideOpenMethod?: IDEOpenMethod) {
  if (ideOpenMethod === "reuse") {
    return "-r";
  } else if (ideOpenMethod === "new") {
    return "-n";
  } else {
    return "";
  }
}

interface LaunchIDEParams {
  file: string;
  line?: number;
  column?: number;
  editor?: Editor;
  method?: IDEOpenMethod;
  format?: string | string[];
  onError?: (file: string, error: string) => void;
}

/**
 * 启动 IDE 并打开指定文件
 * @param params 配置参数，包括：
 *   - file: 要打开的文件路径
 *   - line: 行号（可选）
 *   - column: 列号（可选）
 *   - editor: 指定的编辑器（可选）
 *   - method: 打开方式（可选）
 *   - format: 路径格式化配置（可选）
 *   - onError: 错误处理回调（可选）
 */
export function launchIDE(params: LaunchIDEParams) {
  // 解构参数，设置默认值
  let {
    file,
    line = 1,
    column = 1,
    editor: _editor,
    method,
    format,
    onError,
  } = params;

  // 检查文件是否存在， 不存在则直接返回
  if (!fs.existsSync(file)) {
    return;
  }

  // 获取编辑器信息和启动参数
  // 猜测是哪款编辑器？ 如何猜测呢？ 依据是什么呢？ 命令行为什么可以直接打开 ide 呢？
  let [editor, ...args] = guessEditor(_editor);

  // 获取 path format，获取路径格式化配置，优先使用环境变量中的配置
  const pathFormat = getEnvFormatPath() || format;

  // 如果编辑器无法自动识别，则输出错误信息并返回
  if (!editor || editor.toLowerCase() === "none") {
    if (typeof onError === "function") {
      onError(file, "Failed to recognize IDE automatically");
    } else {
      console.log(
        "Failed to recognize IDE automatically, add something like " +
          chalk.cyan("CODE_EDITOR=code") +
          " to the " +
          chalk.green(".env.local") +
          " file in your project folder," +
          " or add " +
          chalk.green('editor: "code"') +
          " to CodeInspectorPlugin config, " +
          "and then restart the development server. Learn more: " +
          chalk.green("https://goo.gl/MMTaZt")
      );
    }
    return;
  }

  // WSL(Windows Subsystem for Linux)环境特殊处理
  // 将 WSL 路径转换为 Windows 相对路径
  if (
    process.platform === "linux" &&
    file.startsWith("/mnt/") &&
    /Microsoft/i.test(os.release())
  ) {
    // Assume WSL / "Bash on Ubuntu on Windows" is being used, and
    // that the file exists on the Windows file system.
    // `os.release()` is "4.4.0-43-Microsoft" in the current release
    // build of WSL, see: https://github.com/Microsoft/BashOnWindows/issues/423#issuecomment-221627364
    // When a Windows editor is specified, interop functionality can
    // handle the path translation, but only if a relative path is used.
    file = path.relative("", file);
  }

  // 构建编辑器启动参数
  let workspace = null;
  if (line) {
    // 如果指定了行号，添加行号和列号相关参数
    args = args.concat(
      getArguments({
        processName: editor,
        fileName: file,
        lineNumber: line,
        colNumber: column,
        workspace,
        openWindowParams: getOpenWindowParams(method),
        pathFormat,
      })
    );
  } else {
    // 否则只添加文件路径
    args.push(file);
  }

  // 终端编辑器特殊处理：如果已有进程在运行，先终止它
  if (_childProcess && isTerminalEditor(editor)) {
    // There's an existing editor process already and it's attached
    // to the terminal, so go kill it. Otherwise two separate editor
    // instances attach to the stdin/stdout which gets confusing.
    _childProcess.kill("SIGKILL");
  }

  // Windows 平台特殊处理
  if (process.platform === "win32") {
    // this two funcs according to launch-editor
    // compatible for some special characters
    // 处理 Windows 命令行特殊字符
    const escapeCmdArgs = (cmdArgs: string | null) => {
      return cmdArgs!.replace(/([&|<>,;=^])/g, "^$1");
    };

    // 处理包含特殊字符的路径，添加引号
    const doubleQuoteIfNeeded = (str: string | null) => {
      if (str!.includes("^")) {
        return `^"${str}^"`;
      } else if (str!.includes(" ")) {
        return `"${str}"`;
      }
      return str;
    };

    // 构建 Windows 命令行
    const launchCommand = [editor, ...args.map(escapeCmdArgs)]
      .map(doubleQuoteIfNeeded)
      .join(" ");

    // 使用 exec 启动进程
    _childProcess = child_process.exec(launchCommand, {
      stdio: "inherit",
      // @ts-ignore
      shell: true,
      env: {
        ...process.env,
        NODE_OPTIONS: "",
      },
    });
  } else {
    // 非 Windows 平台使用 spawn 启动进程
    _childProcess = child_process.spawn(editor, args as string[], {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS: "",
      },
    });
  }

  // 监听进程退出事件
  _childProcess.on("exit", function (errorCode: string) {
    _childProcess = null;

    // 处理错误退出
    if (errorCode) {
      if (typeof onError === "function") {
        onError(file, "(code " + errorCode + ")");
      } else {
        printInstructions(file, "(code " + errorCode + ")");
      }
    }
  });

  // 监听进程错误事件
  _childProcess.on("error", function (error: { message: any }) {
    if (typeof onError === "function") {
      onError(file, error.message);
    } else {
      printInstructions(file, error.message);
    }
  });
}

export * from "./type";
export { formatOpenPath } from "./get-args";
