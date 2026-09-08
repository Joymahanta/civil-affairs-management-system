const Module = require('module');
const path = require('path');
const target = path.resolve(__dirname, 'cams-current-fixes.js');
const originalCompile = Module.prototype._compile;

Module.prototype._compile = function(content, filename) {
  if (path.resolve(filename) === target) {
    content = content.replace(
      'install(this).catch(e=>console.error(\'[cams-current-fixes]\',e))',
      'Promise.resolve(install(this)).catch(e=>console.error(\'[cams-current-fixes]\',e))'
    );
  }
  return originalCompile.call(this, content, filename);
};
