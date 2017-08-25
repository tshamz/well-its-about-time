const moment = require('moment');
const tookYaLongEnough = require('./took-ya-long-enough.js');

const sendIt = () => {
  if (moment().day() === 5) {
    console.log('it\'s Friday!');
    tookYaLongEnough.sendReminders();
  } else {
    console.log('it\'s not Friday.');
  };
  return;
};

sendIt();
