import type { ProjectFile, ProjectFileKind } from '../../types';

// Display-only refinement of ProjectFileKind. The contract `kind` lumps all
// source under `code`; the Design Files surface splits CSS/SCSS/etc. into a
// dedicated "Stylesheets" section to mirror Claude Design. Everything else
// maps 1:1 to its kind.
export type FileCategory = ProjectFileKind | 'stylesheet';

// Section render order. Empty categories are skipped; the FOLDERS section is
// pinned above all of these from the directory list.
export const SECTION_ORDER: FileCategory[] = [
  'html',
  'stylesheet',
  'code',
  'document',
  'text',
  'image',
  'sketch',
  'pdf',
  'presentation',
  'spreadsheet',
  'video',
  'audio',
  'binary',
];

export const STYLESHEET_EXTENSIONS = new Set(['css', 'scss', 'sass', 'less']);

export function fileCategory(file: ProjectFile): FileCategory {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (STYLESHEET_EXTENSIONS.has(ext)) return 'stylesheet';
  return file.kind;
}

/**
 * Plural section header key for a category.
 *
 * Lives here rather than in DesignFilesPanel so every surface that renders the
 * structure tree (the Design Files panel and the canvas edit rail) labels a
 * group the same way, without either importing the other.
 */
export function sectionLabelKey(category: FileCategory): string {
  switch (category) {
    case 'html':
      return 'designFiles.sectionPages';
    case 'stylesheet':
      return 'designFiles.sectionStylesheets';
    case 'code':
      return 'designFiles.sectionScripts';
    case 'document':
      return 'designFiles.sectionDocuments';
    case 'image':
      return 'designFiles.sectionImages';
    case 'sketch':
      return 'designFiles.sectionSketches';
    case 'binary':
      return 'designFiles.sectionOther';
    case 'text':
      return 'designFiles.kindText';
    case 'pdf':
      return 'designFiles.kindPdf';
    case 'presentation':
      return 'designFiles.kindPresentation';
    case 'spreadsheet':
      return 'designFiles.kindSpreadsheet';
    default:
      return 'designFiles.kindBinary';
  }
}
