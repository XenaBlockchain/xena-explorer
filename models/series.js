'use strict';
import { Model, DataTypes } from 'sequelize';


export default (sequelize) => {
  class Series extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      models.Series.hasMany(models.Tokens,{
        foreignKey: 'id',
      })
      // define association here
    }
  }
  Series.init({
    name: DataTypes.STRING,
    author: DataTypes.STRING,
    cover_image: DataTypes.JSON,
    identifier: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
    }
  }, {
    sequelize,
    modelName: 'Series',
  });
  return Series;
};