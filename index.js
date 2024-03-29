import mongoose from 'mongoose';
import chalk from 'chalk';
import ora, { oraPromise } from 'ora';
import readline from 'readline';
import config from './config.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const defaultTextColor = 'cyan';
const spinnerColor = 'yellow';
const colors = {
  text: chalk[defaultTextColor],
  error: chalk.red,
  success: chalk.green,
  warn: chalk.yellow,
  info: chalk.blue,
  debug: chalk.magenta,
  special: chalk.cyanBright,
};
const logLevels = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
const logLevel = logLevels[config.logLevel.toLowerCase()] ?? logLevels.info;

const logDebug = (...text) => {
  if (logLevel <= logLevels.debug) console.debug(colors.debug('🛠', ...text));
};
const logInfo = (...text) => {
  if (logLevel <= logLevels.info) console.info(colors.info('ℹ', ...text));
};
const logWarn = (...text) => {
  if (logLevel <= logLevels.warn) console.warn(colors.warn('⚠', ...text));
};
const logError = (...text) => {
  if (logLevel <= logLevels.error) console.error(colors.error('⨯', ...text));
};

const promisify = (func) =>
  new Promise((resolve, reject) => {
    try {
      const result = func();
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });

const oraOptions = {
  color: spinnerColor,
  spinner: 'dots',
  isEnabled: true,
  discardStdin: true,
};
const load = (text, color) => {
  if (logLevel >= logLevels.warn)
    return {
      stop: () => {},
      start: () => {},
      fail: logLevel <= logLevels.error ? logError : () => {},
      info: () => {},
      succeed: () => {},
      warn: logLevel === logLevels.warn ? logWarn : () => {},
    };

  return ora({ ...oraOptions, text: chalk[color ?? defaultTextColor](text) });
};
const loadPromise = (
  promise,
  { color, text, failText, successText, ...options },
) => {
  if (logLevel === logLevels.silent) return promise;
  if (logLevel >= logLevels.warn)
    return promise.catch((error) => {
      logError(failText ?? text);
      throw error;
    });

  return oraPromise(promise, {
    ...oraOptions,
    ...options,
    text: chalk[color ?? defaultTextColor](text),
    failText: colors.error(failText),
    successText: colors.success(successText),
  }).catch((error) => {
    logDebug(error);
    throw error;
  });
};

const standardCollections = [];

function logDebugData() {
  if (logLevel > logLevels.debug) return;
  const { dbUri, ...printableConfig } = config;

  logDebug(`[${logDebugData.name}]`, 'Log Level:', logLevel);
  logDebug(`[${logDebugData.name}]`, 'Config:', JSON.stringify(config.insecureDebugLog ? printableConfig : config));
  logDebug(`[${logDebugData.name}]`, 'Standard Collections:', JSON.stringify(standardCollections));
}

function validatePath({ path, collectionName }) {
  const extensionIndex = path.lastIndexOf('.');
  const extension = path.slice(extensionIndex + 1);
  const allowedExtensions = ['json', 'js', 'mjs'];

  if (path.lastIndexOf('.') === -1 || !allowedExtensions.includes(extension)) {
    logError(
      `Invalid file extension '.${extension}' in the path '${path}' of '${collectionName}'.`,
    );
    if (extension === 'cjs')
      logWarn(
        'CommonJS is not supported in this script, use ES6 modules instead',
      );
    return false;
  }

  return true;
}

async function evaluateCollectionValues({
  path,
  collectionName,
  data,
  model,
  schema,
}) {
  const { preferPath } = config;
  let importedValues;

  const getStandardValue = ({ configValue, pathValue }) =>
    preferPath ? pathValue ?? configValue : configValue;

  if (path)
    try {
      if (!validatePath({ path, collectionName })) return null;

      importedValues = await import(path);
    } catch (error) {
      logError(`The path '${path}' of '${collectionName}' is invalid!`);
      logDebug(`[${evaluateCollectionValues.name}]`, error);

      return null;
    }

  return {
    standardData: getStandardValue({
      pathValue:
        importedValues.default?.data ??
        importedValues.default ??
        importedValues.data,
      configValue: data,
    }),
    standardModel: getStandardValue({
      pathValue: importedValues.default?.model ?? importedValues.model,
      configValue: model,
    }),
    standardSchema: getStandardValue({
      pathValue: importedValues.default?.schema ?? importedValues.schema,
      configValue: schema,
    }),
  };
}

async function initialise() {
  // Validate Mongo URI values
  const mongoUriValues = new Set(
    ['MONGO_URI', 'MONGODB_URI', 'mongoUri', 'DB_URI', 'DATABASE_URI'].filter(
      (name) => name in process.env,
    ),
  );

  if (!config.mongoUri && !mongoUriValues.size) {
    logError('No MongoDB URI provided');
    throw new Error('No MongoDB URI provided');
  }

  if (
    mongoUriValues.size > 1 ||
    (mongoUriValues.size &&
      config.mongoUri !== mongoUriValues.values().next())
  ) {
    logError(
      'Mismatch between MongoDB URIs:',
      [config.mongoUri, ...Array.from(mongoUriValues)]
        .filter((uri) => uri)
        .join(', '),
    );
    throw new Error('Mismatch between MongoDB URIs');
  }

  // If config.mongoUri is unset, that means that the value is in the process.env
  config.mongoUri ??= mongoUriValues.values().next();

  // Connect to mongoose
  await loadPromise(
    mongoose.connect(
      config.mongoUri ??
        process.env[
          [
            'MONGO_URI',
            'MONGODB_URI',
            'mongoUri',
            'DB_URI',
            'DATABASE_URI',
          ].find((name) => name in process.env)
        ],
    ),
    {
      text: 'Connecting to MongoDB',
      successText: 'Connected to MongoDB',
      failText: 'Failed to connect to MongoDB',
    },
  );

  // Create all models
  const modelsPromise = () =>
    Promise.all(
      Object.keys(config.collections).map(async (collectionName) => {
        const { model, schema, path, data } =
          config.collections[collectionName];

        if (!data?.length && !path) {
          logError(`No data or path for '${collectionName}'!`);
          return;
        }

        if (path && data?.length)
          logWarn(
            `Both data and path were provided in '${collectionName}', using ${
              config.preferPath ? 'path' : 'data'
            }. To change this behavior, change 'preferPath' in config.js.`,
          );

        const { standardModel, standardSchema, standardData, error } =
          await loadPromise(
            evaluateCollectionValues({
              path,
              collectionName,
              model,
              schema,
              data,
            }),
            {
              successText: `Evaluated the values of '${collectionName}'`,
              failText: `Failed to evaluate the values of '${collectionName}'`,
              text: `Evaluating the values of '${collectionName}'`,
            },
          ).catch(() => ({ error: true }));

        if (error) return;

        if (!(standardData && standardSchema && standardModel)) {
          logError(
            `Invalid data, schema or model name for collection '${collectionName}'!`,
          );
          return;
        }

        standardCollections.push({
          name: collectionName,
          model: mongoose.model(standardModel, standardSchema, collectionName),
          data: standardData,
        });
      }),
    );

  await loadPromise(modelsPromise, {
    text: 'Creating models',
    successText: 'Created models',
    failText: 'Failed to create models',
  });
  
  logDebugData();

  if (standardCollections.length === 0) {
    logError('No valid collections found!');
    throw new Error('No valid collections found!');
  }
}

async function dryRun() {
  await loadPromise(initialise(), {
    text: 'Initialising',
    successText: 'Initialised',
    failText: 'Failed to initialise',
  });

  // Print how many documents would be deleted and inserted for each collection
  await loadPromise(
    Promise.all([
      Promise.all(
        standardCollections.map(async ({ name, model }) => {
          const count = await model.countDocuments();

          return `${colors.special(name)} - ${colors.special(count)}`;
        }),
      ),
      promisify(() =>
        standardCollections.map(({ name, data }) =>
          data
            ? `${colors.special(name)} - ${colors.special(data.length)}`
            : logDebug(`[${dryRun.name}] Data is undefined in ${name}`),
        ),
      ),
    ]),
    {
      text: 'Counting documents',
      failText: 'Failed to count documents',
      successText: 'Counted documents',
    },
  ).then(([deleteMessages, insertMessages]) =>
    logInfo(
      chalk.bold('Documents that would be deleted'),
      '\n',
      deleteMessages.join('\n'),
      '\n\n',
      chalk.bold('Documents that would be inserted'),
      '\n',
      insertMessages.join('\n'),
    ),
  );
}

async function run() {
  // Initialise
  await loadPromise(initialise(), {
    text: 'Initialising',
    successText: 'Initialised',
    failText: 'Failed to initialise',
  });

  // Drop all collections
  await loadPromise(
    Promise.all(standardCollections.map(({ model }) => model.deleteMany({}))),
    {
      text: 'Dropping collections',
      successText: 'Dropped collections',
      failText: 'Failed to drop collections',
    },
  );

  // Insert all documents
  await loadPromise(
    Promise.all(
      standardCollections.map(({ model, data }) => model.insertMany(data)),
    ),
    {
      text: 'Inserting documents',
      successText: 'Inserted documents',
      failText: 'Failed to insert documents',
    },
  );
}

function startDryRun() {
  loadPromise(dryRun(), {
    text: 'Performing a dry run',
    successText: 'Dry run complete',
    failText: 'Failed to perform a dry run',
  })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

function startRun() {
  // Prompt user whether they're sure they want to run this script
  if (!config.noPrompt)
    rl.question(
      'Running this script will delete all existing documents in the collections specified in the configuration file. Are you sure you want to continue? (y/N) ',
      (answer) => {
        rl.close();
        if (answer.toLowerCase() !== 'y') {
          logInfo('Exiting');
          process.exit(0);
        }
      },
    );

  loadPromise(run(), {
    text: 'Performing a run',
    successText: 'Run complete',
    failText: 'Failed to perform a run',
  })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

if (process.argv[2] === '--dry-run') startDryRun();
else startRun();
