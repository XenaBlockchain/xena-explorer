'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		/**
		 * This command creates the preferences table and all the columns and keys that are a part of it.
		 *
		 */
		await queryInterface.createTable('Preferences', {
			id: {
				allowNull: false,
				autoIncrement: true,
				primaryKey: true,
				type: Sequelize.INTEGER
			},
			key: {
				allowNull: false,
				type: Sequelize.STRING,
				unique: true
			},
			value: {
				allowNull: true,
				type: Sequelize.STRING
			},
			createdAt: {
				allowNull: false,
				type: Sequelize.DATE
			},
			updatedAt: {
				allowNull: false,
				type: Sequelize.DATE
			}
		});
	},

	async down(queryInterface, Sequelize) {
		/**
		 * The down command is used to reverse this migration, when it is run it is supposed to do the opposite of the above,
		 * in this case we are just dropping the table we made for storing preferences
		 */
		await queryInterface.dropTable('Preferences');
	}
};
