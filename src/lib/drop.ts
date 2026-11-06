/** 外部拖入文件的判定逻辑（纯函数，方便单测） */

/** 认可的文档扩展名，和「打开」对话框保持一致 */
export const DOC_EXTENSIONS = [".md", ".markdown", ".txt"];

export function isDocPath(path: string, extensions: string[] = DOC_EXTENSIONS): boolean {
  const lower = path.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

export function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
