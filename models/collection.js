'use strict';
import { Model, DataTypes } from 'sequelize';


export default (sequelize) => {
  class Collection extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      models.Collection.hasMany(models.Token,{
        foreignKey: 'id',
      })
      // define association here
    }
  }
  Collection.init({
    name: DataTypes.STRING,
    author: DataTypes.STRING,
    group: DataTypes.STRING,
    cover_image: DataTypes.JSON,
    identifier: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
    }
  }, {
    sequelize,
    modelName: 'Collection',
    tableName: 'Collections'
  });
  return Collection;
};
