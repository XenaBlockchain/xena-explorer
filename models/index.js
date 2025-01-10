/**
 * This file is used to import and configure the sequelize database setting up params, with the ability to use a remote
 * database rather than a sqlite db
 * importing the ORM models and association of models and relationships.
 * finally it exports the database model to be used by the explorer application
 *
 * **/
import debug from "debug";
const debugLog = debug("nexexp:sql");

import fs from 'fs';
import path from 'path';
import { Sequelize } from 'sequelize';
import process from 'process';
import { fileURLToPath } from 'url';
import configFile from '../sequelize_config/config.json' assert { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = configFile[env];
const db = {};

let sequelize;

// add concurency testing to the config hash
config.transactionType =  'IMMEDIATE';
config.logging =  msg => debugLog(msg);

if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

sequelize.query('PRAGMA journal_mode=WAL;')

const files = fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  });

for (const file of files) {
  const modelModule = await import(path.join(__dirname, file));
  const model = modelModule.default(sequelize, Sequelize.DataTypes);
  db[model.name] = model;
}

for (const modelName of Object.keys(db)) {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
}

db.sequelizeInstance = sequelize;
db.Sequelize = Sequelize;

export default db;
