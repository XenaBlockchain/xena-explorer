'use strict';
import { Model, DataTypes } from 'sequelize';

export default (sequelize) => {
  class Token extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      models.Token.belongsTo(models.Collection,{
        foreignKey: 'collection_id',
      })
    }
  }

  Token.init({
    group: DataTypes.STRING,
	nft_provider_url: DataTypes.STRING,
	nft_provider_name: DataTypes.STRING,
    parent: DataTypes.STRING,
    is_nft: DataTypes.BOOLEAN,
    collection_id: DataTypes.INTEGER,
    collection: DataTypes.STRING,
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
    modelName: 'Token',
	tableName: 'Tokens'
  });

  return Token;
};
