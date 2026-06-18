import type { Linter } from 'eslint';

export interface CreateConfigOptions {
	tsconfigRootDir: string;
	svelteConfig: unknown;
}

export function createConfig(options: CreateConfigOptions): Linter.Config[];
