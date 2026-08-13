import type { Context } from '@deepseek-ai/cordis';
import { parseCmdline } from '@deepseek-ai/dsh-cmdline';
import { Command } from 'commander';

export const name = 'open-design-startup';
export const inject = ['cmdlineArgs'];
export const OPEN_DESIGN_STARTUP_SERVICE = 'openDesignStartup';

export interface OpenDesignStartupValues {
  mode: 'probe' | 'stdio';
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    openDesignStartup?: OpenDesignStartupValues;
  }
}

export function apply(ctx: Context): void {
  const program = new Command()
    .name('dsh --profile open-design')
    .description('Run the Open Design JSONL profile adapter.')
    .helpOption('-h, --help', 'show this help')
    .option('--probe', 'print profile compatibility and exit')
    .option('--stdio', 'serve one Open Design run over JSONL stdio')
    .action((options: { probe?: boolean; stdio?: boolean }) => {
      if (Boolean(options.probe) === Boolean(options.stdio)) {
        program.error('error: exactly one of --probe or --stdio is required');
      }
      ctx.provide(OPEN_DESIGN_STARTUP_SERVICE, {
        mode: options.probe ? 'probe' : 'stdio',
      } satisfies OpenDesignStartupValues);
    });
  parseCmdline(ctx, program);
}
