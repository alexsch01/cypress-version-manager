"use strict";

const path = require('node:path');
const fs = require('node:fs');
const { execSync, spawn } = require('node:child_process');

const VERSION_FILE = '.cypress-version';

function findVersionFile(startDir) {
  let currentDir = startDir;

  while (true) {
    const versionPath = path.join(currentDir, VERSION_FILE);

    if (fs.existsSync(versionPath)) {
      let version = fs.readFileSync(versionPath, 'utf8').trim();
      if (version.startsWith('"') && version.endsWith('"')) {
        version = version.slice(1, version.length-1);
      }
      if (version === '') return null;
      return { version, projectRoot: currentDir };
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

function getGlobalNodeModulesPath() {
  try {
    const npmRoot = execSync('npm root -g', {
      shell: true,
      encoding: 'utf8',
    }).trim();

    return npmRoot;
  } catch {
    console.error('  npm root -g failed');
    process.exit(1);
  }

  return null;
}

function resolveCypressBinary(version, globalModulesPath, packageName) {
  const versionedPackageName = `cypress-${version}`;
  let binaryPath;

  if (packageName === 'cypress') {
    binaryPath = path.join(
      globalModulesPath,
      versionedPackageName,
      'node_modules/cypress/bin/cypress',
    );
  } else if (packageName === 'cypress-ntlm') {
    binaryPath = path.join(
      globalModulesPath,
      versionedPackageName,
      'node_modules/cypress-ntlm-auth/dist/launchers/cypress.ntlm.js',
    );
  } else {
    console.error('  Not implemented!');
    process.exit(1);
  }

  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  return null;
}

function get_jsconfig(cypressTypeRoot) {
  let originalJsConfig;
  try {
    originalJsConfig = fs.readFileSync('./jsconfig.json').toString();
  } catch(_) {
    originalJsConfig = '{}';
  }

  let jsconfig;
  try {
    jsconfig = JSON.parse(originalJsConfig);
    if (typeof jsconfig !== 'object' || Array.isArray(jsconfig)) {
      throw new Error;
    }
  } catch(_) {
    console.error('  Bad jsconfig.json file');
    process.exit(1);
  }

  const jsconfig_compilerOptions = jsconfig.compilerOptions;
  if (typeof jsconfig_compilerOptions !== 'object') {
    jsconfig_compilerOptions = {};
  }

  return [
    JSON.stringify({
      ...jsconfig,
      compilerOptions: {
        ...jsconfig_compilerOptions,
        typeRoots: [cypressTypeRoot],
        types: []
      }
    }, null, 4),
    originalJsConfig
  ];
}

module.exports.main = function(packageName) {
  const cwd = process.cwd();
  const versionInfo = findVersionFile(cwd);

  if (!versionInfo) {
    console.error(`Error: No ${VERSION_FILE} file found in current directory or ancestors.`);
    console.error('');
    console.error(`Create a ${VERSION_FILE} file with the desired version:`);
    console.error(`  echo "13.16.0" > ${VERSION_FILE}`);
    process.exit(1);
  }

  const { version, projectRoot } = versionInfo;
  const globalModulesPath = getGlobalNodeModulesPath();

  if (!globalModulesPath) {
    console.error('Error: Could not determine global npm modules path.');
    console.error('Ensure npm is installed and accessible.');
    process.exit(1);
  }

  const cypressBinary = resolveCypressBinary(version, globalModulesPath, packageName);

  if (!cypressBinary) {
    const missingCypressVersionPath = path.resolve(globalModulesPath, `cypress-${version}`);

    console.error(`Error: Cypress ${version} not found at "${missingCypressVersionPath}"`);
    console.error('');
    console.error('Install it with:');
    console.error(`  npm install cypress@${version} cypress-ntlm-auth cypress-mochawesome-reporter @cypress/webpack-preprocessor --prefix "${missingCypressVersionPath}" --save-exact --ignore-scripts`);
    console.error('  npx cypress install');
    process.exit(1);
  }

  const globalCypressPath = path.resolve(globalModulesPath, `cypress-${version}`, 'node_modules');

  const [jsconfig, originalJsConfig] = get_jsconfig(globalCypressPath);
  if (jsconfig !== originalJsConfig) {
    fs.writeFileSync('./jsconfig.json', jsconfig);
  }

  // Pass through all arguments and add default project for cypress open
  const args = process.argv.slice(2);
  if (args.includes('open') && !args.includes('--project')) {
    args.push('--project', '.');
  }

  args.unshift(cypressBinary);

  let preloadPath = path.resolve(__dirname, 'preload.js');
  if (process.platform === 'win32') {
    preloadPath = preloadPath.replaceAll("\\", "\\\\");
  }

  const child = spawn('node', args, {
    stdio: 'inherit',
    cwd: projectRoot,
    env: {
      ...process.env,
      CYPRESS_VERSION_MANAGER_GLOBAL_CYPRESS_PATH: globalCypressPath,
      NODE_OPTIONS: `--require "${preloadPath}" ${process.env.NODE_OPTIONS || ''}`,
    },
  });

  child.on('exit', (code) => {
    process.exitCode = code;
  });
}
