import axios from 'axios';

async function testEmail() {
  try {
    const res = await axios.post('http://localhost:8085/app/functions/sendSystemMail', {
      recipient: 'helpdesk@lhinigeria.org',
      subject: 'Test Email',
      html: '<p>This is a test email</p>',
      from: 'helpdesk@lhinigeria.org'
    }, {
      headers: {
        'X-Parse-Application-Id': 'opensign'
      }
    });
    console.log(res.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}
testEmail();
