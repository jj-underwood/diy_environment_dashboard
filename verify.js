// verify.js
document.getElementById('verify-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const code = document.getElementById('code').value;
    const response = await fetch('https://apigateway-url/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
    });
    if (response.ok) {
        const data = await response.json();
        console.log('data.body', data.body);
        console.log('data.body.token', data.body.token);
	console.log('Token before line 15:', localStorage.getItem('token'));
        localStorage.setItem('token', data.body.token);
	console.log('Token before line 15:', localStorage.getItem('token'));
        alert('Authenticated successfully');
        window.location.href = 'dashboard.html';
    } else {
        alert('Invalid code');
    }
});
