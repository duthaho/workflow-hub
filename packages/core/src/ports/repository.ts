export interface RepositoryPort {
  resolveRef(ref: string): Promise<string>;
  mergeBase(baseRef: string, headRef: string): Promise<string>;
  changedFiles(baseSha: string, headSha: string): Promise<string[]>;
  diff(baseSha: string, headSha: string): Promise<string>;
  fileLineCount(path: string, ref: string): Promise<number | undefined>;
}
