export type DiagnosticLanguage = 'typescript' | 'python' | 'java' | 'go';

export interface FormattedDiagnostic {
  filePath?: string;
  line?: number;
  column?: number;
  code: number | string;
  category: string;
  message: string;
  language: DiagnosticLanguage;
}
