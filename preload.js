"use strict";

const Module = require('node:module');
const path = require('node:path');
const cp = require('node:child_process');
const fs = require('node:fs');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'cypress' || request.startsWith('cypress/') || request === 'cypress-mochawesome-reporter' || request.startsWith('cypress-mochawesome-reporter/')) {
        const globalCypressPath = process.env.CYPRESS_VERSION_MANAGER_GLOBAL_CYPRESS_PATH;
        const newRequest = path.resolve(globalCypressPath, request);

        return originalResolveFilename.apply(this, [
            newRequest,
            parent,
            isMain,
            options,
        ]);
    }
    return originalResolveFilename.apply(this, arguments);
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request.endsWith('cypress.config.js')) {
        const cypressConfigFile = fs.readFileSync(request, 'utf8');
        if (!cypressConfigFile.includes('module.exports = defineConfig({')) {
            throw new Error('Need to use defineConfig in cypress.config.js');
        }
    }

    const loadedModule = originalLoad.apply(this, arguments);

    // If the module being required is the root 'cypress' package
    if (request === 'cypress') {
        const globalCypressPath = process.env.CYPRESS_VERSION_MANAGER_GLOBAL_CYPRESS_PATH;
        const newWebpackPath = path.resolve(globalCypressPath, '@cypress/webpack-preprocessor');

        const wp = require(newWebpackPath);
        const originalDefineConfig = loadedModule.defineConfig;

        if (originalDefineConfig && !loadedModule._isPatched) {
            loadedModule.defineConfig = function (userConfig = {}) {
                const { e2e = {}, ...restConfig } = userConfig;
                const originalSetupNodeEvents = e2e.setupNodeEvents;

                if (restConfig.reporter === 'cypress-mochawesome-reporter') {
                    restConfig.reporter = path.resolve(globalCypressPath, 'cypress-mochawesome-reporter');
                }

                return originalDefineConfig({
                    ...restConfig,
                    e2e: {
                        ...e2e,
                        setupNodeEvents(on, config) {
                            // Register the Webpack preprocessor automatically
                            on(
                                'file:preprocessor',
                                wp({
                                    webpackOptions: {
                                        resolve: {
                                            modules: [
                                                'node_modules',
                                                globalCypressPath,
                                            ].filter(Boolean),
                                        },
                                    },
                                })
                            );

                            // Run any custom setupNodeEvents logic passed by the user
                            if (typeof originalSetupNodeEvents === 'function') {
                                return originalSetupNodeEvents(on, config);
                            }
                        },
                    },
                });
            };

            loadedModule._isPatched = true;
        }
    }

    return loadedModule;
};

const originalSpawn = cp.spawn;
cp.spawn = function (command, args, options) {
    const newOptions = { ...options };
    if (newOptions.env) {
        delete newOptions.env.NODE_OPTIONS;
    }
    return originalSpawn.apply(this, [command, args, newOptions]);
};
