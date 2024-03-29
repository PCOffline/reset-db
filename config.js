import mongoose from 'mongoose';

const { Schema } = mongoose;

export default {
  noPrompt: false, // Don't prompt before deleting
  preferPath: true, // When both path and data are provided, ignore the data and only use the path. If false, only the data will be used in such case.
  logLevel: 'debug', // 'debug' | 'info' | 'warn' | 'error' | 'silent'
  mongoUri: 'mongodb://localhost:27017/my-database', // Can also be retrieved from environment variable: MONGO_URI, MONGODB_URI, DB_URI, DATABASE_URI or mongoUri
  sensitiveDebugLog: false, // Log information that is considered sensitive (such as the MongoDB URI) in debug mode.
  collections: {
    collectionName: {
      schema: new Schema({
        // The mongoose schema of the collection
        fieldName: {
          type: Schema.Types.String,
          required: true,
        },
      }),
      model: 'modelName', // The name of the model to use, will be equal to the collection name by default, use it in order to not break refs
      data: [
        // The data to be inserted into the collection
        {
          fieldName: 'value',
        },
      ],
      path: 'path/to/file.json', // alternative to 'data', can be either .json, .js or .mjs with default export
    },
  },
};
