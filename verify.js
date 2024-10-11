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
        console.log('data', data);
        console.log('data.token', data.token);
        localStorage.setItem('token', data.token);
	console.log('Token stored in localStorage:', localStorage.getItem('token'));
        alert('Authenticated successfully');
        window.location.href = 'dashboard.html';
    } else {
        alert('Invalid code');
    }
});
