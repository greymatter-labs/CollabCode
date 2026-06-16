import { transform } from 'sucrase';

window.CollabTypeScriptTransform = {
  transform(code, filePath) {
    return transform(String(code || ''), {
      filePath: filePath || 'main.ts',
      transforms: ['typescript', 'imports'],
      production: true
    }).code;
  }
};
