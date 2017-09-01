const moment = require('moment');
const app = require('./app.js');

const sendIt = () => {
  if (moment().day() === 5) {
    console.log('it\'s Friday!');
    app.sendReminders('Development');
  } else {
    console.log('it\'s not Friday.');
  };
  return;
};

sendIt();
