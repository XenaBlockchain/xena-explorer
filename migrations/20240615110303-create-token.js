'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Tokens', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      group: {
        allowNull: false,
        type: Sequelize.STRING
      },
      parent: {
        type: Sequelize.STRING
      },
      is_nft: {
        type: Sequelize.BOOLEAN
      },
      nft_data: {
        type: Sequelize.JSON
      },
      series_id: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      series: {
        type: Sequelize.STRING
      },
      author: {
        type: Sequelize.STRING
      },
      holders: {
        type: Sequelize.INTEGER
      },
      transfers: {
        type: Sequelize.INTEGER
      },
      max_supply: {
        type: Sequelize.STRING
      },
      name: {
        type: Sequelize.STRING
      },
      ticker: {
        type: Sequelize.STRING
      },
      document_info: {
        type: Sequelize.JSON
      },
      genesis: {
        type: Sequelize.JSON
      },
      files:{
        type: Sequelize.JSON
      },
      genesis_datetime: {
        allowNull: false,
        type: Sequelize.DATE
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
    await queryInterface.dropTable('Tokens');
  }
};