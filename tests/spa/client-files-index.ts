/**
 * The Clients doors read client_files through ClientFilesIndex.gs. Booted here, its grouping and candidate match run
 * over the test's own listRows_('clientFiles') table, never a cache, and a paper's whole row is that table's row.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const gs = (file: string) => readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(), 'apps-script', file), 'utf8')

export function bootClientFiles(ctx: vm.Context): void {
  if (vm.runInContext('typeof locationsDriveId_', ctx) !== 'function') {
    const src = gs('Locations.gs')
    const at = src.indexOf('\nfunction locationsDriveId_(')
    vm.runInContext(src.slice(at + 1, src.indexOf('\n}', at + 1) + 2), ctx)
  }
  vm.runInContext(gs('ClientFilesIndex.gs'), ctx)
  vm.runInContext(`
    cfxSheetRows_ = function () { return listRows_('clientFiles', {}); };
    cfxState_ = function () { return cfxBuild_('', null); };
    clientFileWhole_ = function (slim) {
      return listRows_('clientFiles', {}).filter(function (r) {
        return String(r.id || '') === String(slim.id || '') && String(r.drive_id || '') === String(slim.drive_id || '');
      })[0] || null;
    };`, ctx)
}
