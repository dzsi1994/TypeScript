/// <reference path="..\services\services.ts" />
/// <reference path="utilities.ts" />
/// <reference path="scriptInfo.ts" />

namespace ts.server {
    export class LSHost implements ts.LanguageServiceHost, ModuleResolutionHost, ServerLanguageServiceHost {
        private compilationSettings: ts.CompilerOptions;
        private readonly resolvedModuleNames: ts.FileMap<Map<ResolvedModuleWithFailedLookupLocations>>;
        private readonly resolvedTypeReferenceDirectives: ts.FileMap<Map<ResolvedTypeReferenceDirectiveWithFailedLookupLocations>>;
        private readonly getCanonicalFileName: (fileName: string) => string;

        constructor(private readonly host: ServerHost, private readonly project: Project, private readonly cancellationToken: HostCancellationToken) {
            this.getCanonicalFileName = ts.createGetCanonicalFileName(this.host.useCaseSensitiveFileNames);
            this.resolvedModuleNames = createFileMap<Map<ResolvedModuleWithFailedLookupLocations>>();
            this.resolvedTypeReferenceDirectives = createFileMap<Map<ResolvedTypeReferenceDirectiveWithFailedLookupLocations>>();
        }

        private resolveNamesWithLocalCache<T extends { failedLookupLocations: string[] }, R>(
            names: string[],
            containingFile: string,
            cache: ts.FileMap<Map<T>>,
            loader: (name: string, containingFile: string, options: CompilerOptions, host: ModuleResolutionHost) => T,
            getResult: (s: T) => R): R[] {

            const path = toPath(containingFile, this.host.getCurrentDirectory(), this.getCanonicalFileName);
            const currentResolutionsInFile = cache.get(path);

            const newResolutions: Map<T> = {};
            const resolvedModules: R[] = [];
            const compilerOptions = this.getCompilationSettings();

            for (const name of names) {
                // check if this is a duplicate entry in the list
                let resolution = lookUp(newResolutions, name);
                if (!resolution) {
                    const existingResolution = currentResolutionsInFile && ts.lookUp(currentResolutionsInFile, name);
                    if (moduleResolutionIsValid(existingResolution)) {
                        // ok, it is safe to use existing name resolution results
                        resolution = existingResolution;
                    }
                    else {
                        newResolutions[name] = resolution = loader(name, containingFile, compilerOptions, this);
                    }
                }

                ts.Debug.assert(resolution !== undefined);

                resolvedModules.push(getResult(resolution));
            }

            // replace old results with a new one
            cache.set(path, newResolutions);
            return resolvedModules;

            function moduleResolutionIsValid(resolution: T): boolean {
                if (!resolution) {
                    return false;
                }

                if (getResult(resolution)) {
                    // TODO: consider checking failedLookupLocations
                    return true;
                }

                // consider situation if we have no candidate locations as valid resolution.
                // after all there is no point to invalidate it if we have no idea where to look for the module.
                return resolution.failedLookupLocations.length === 0;
            }
        }

        getProjectVersion() {
            return this.project.getProjectVersion();
        }

        getCancellationToken() {
            return this.cancellationToken;
        }

        resolveTypeReferenceDirectives(typeDirectiveNames: string[], containingFile: string): ResolvedTypeReferenceDirective[] {
            return this.resolveNamesWithLocalCache(typeDirectiveNames, containingFile, this.resolvedTypeReferenceDirectives, resolveTypeReferenceDirective, m => m.resolvedTypeReferenceDirective);
        }

        resolveModuleNames(moduleNames: string[], containingFile: string): ResolvedModule[] {
            return this.resolveNamesWithLocalCache(moduleNames, containingFile, this.resolvedModuleNames, resolveModuleName, m => m.resolvedModule);
        }

        getDefaultLibFileName() {
            const nodeModuleBinDir = ts.getDirectoryPath(ts.normalizePath(this.host.getExecutingFilePath()));
            return ts.combinePaths(nodeModuleBinDir, ts.getDefaultLibFileName(this.compilationSettings));
        }

        getScriptSnapshot(filename: string): ts.IScriptSnapshot {
            const scriptInfo = this.project.getScriptInfo(filename);
            if (scriptInfo) {
                return scriptInfo.snap();
            }
        }

        setCompilationSettings(opt: ts.CompilerOptions) {
            this.compilationSettings = opt;
            // conservatively assume that changing compiler options might affect module resolution strategy
            this.resolvedModuleNames.clear();
            this.resolvedTypeReferenceDirectives.clear();
        }

        getCompilationSettings() {
            // change this to return active project settings for file
            return this.compilationSettings;
        }

        getScriptFileNames() {
            return this.project.getRootFiles();
        }

        getScriptKind(fileName: string) {
            const info = this.project.getScriptInfo(fileName);
            return info && info.scriptKind;
        }

        getScriptVersion(filename: string) {
            return this.project.getScriptInfo(filename).getLatestVersion();
        }

        getCurrentDirectory(): string {
            return "";
        }

        removeReferencedFile(info: ScriptInfo) {
            if (!info.isOpen) {
                this.resolvedModuleNames.remove(info.path);
                this.resolvedTypeReferenceDirectives.remove(info.path);
            }
        }

        removeRoot(info: ScriptInfo) {
            this.resolvedModuleNames.remove(info.path);
            this.resolvedTypeReferenceDirectives.remove(info.path);
        }

        resolvePath(path: string): string {
            return this.host.resolvePath(path);
        }

        fileExists(path: string): boolean {
            return this.host.fileExists(path);
        }

        directoryExists(path: string): boolean {
            return this.host.directoryExists(path);
        }

        readFile(fileName: string): string {
            return this.host.readFile(fileName);
        }

        getDirectories(path: string): string[] {
            return this.host.getDirectories(path);
        }
    }
}