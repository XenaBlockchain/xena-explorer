'use strict';
import { Model, DataTypes } from 'sequelize';

export default (sequelize) => {
	class Preference extends Model {
	}

	Preference.init({
		key: DataTypes.STRING,
		value: DataTypes.STRING,
	}, {
		sequelize,
		modelName: 'Preference',
		tableName: 'Preferences'
	});

	return Preference;
};
