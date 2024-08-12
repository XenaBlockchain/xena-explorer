'use strict';
import { Model, DataTypes } from 'sequelize';

export default (sequelize) => {
  class Tokens extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      models.Tokens.belongsTo(models.Series,{
        foreignKey: 'series_id',
      })
      // models.Token.hasMany(models.Transfers)
      // models.Token.hasMany(models.TokenHolders)
    }
  }

  Tokens.init({
    group: DataTypes.STRING,
    parent: DataTypes.STRING,
    is_nft: DataTypes.BOOLEAN,
    series_id: DataTypes.INTEGER,
    series: DataTypes.STRING,
    author: DataTypes.STRING,
    nft_data: DataTypes.JSON,
    holders: DataTypes.INTEGER,
    transfers: DataTypes.INTEGER,
    max_supply: DataTypes.STRING,
    name: DataTypes.STRING,
    ticker: DataTypes.STRING,
    document_info: DataTypes.JSON,
    genesis: DataTypes.JSON,
    files: DataTypes.JSON,
    genesis_datetime: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'Tokens',
  });

  return Tokens;
};
