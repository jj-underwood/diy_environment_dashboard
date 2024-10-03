// login.js
document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const response = await fetch('https://apigateway-url/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    if (response.ok) {
        alert('Code sent to your email');
        window.location.href = 'verify.html';
    } else {
        alert('Failed to send code');
    }
});
