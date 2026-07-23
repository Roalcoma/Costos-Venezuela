<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">
        <img src="../assets/LOGO/Logo con sombra.png" alt="Redesip" class="login-logo-img" />
        <p class="subtitle">Sistema de Gestión de Contenedores</p>
      </div>

      <form @submit.prevent="iniciarSesion" class="login-form">
        <div class="input-group">
          <label>Usuario</label>
          <input
            v-model="usuario"
            type="text"
            placeholder="Ingresa tu usuario"
            autocomplete="username"
            required
          />
        </div>

        <div class="input-group">
          <label>Contraseña</label>
          <input
            v-model="password"
            type="password"
            placeholder="Ingresa tu contraseña"
            autocomplete="current-password"
            required
          />
        </div>

        <div v-if="error" class="error-msg">{{ error }}</div>

        <button type="submit" class="btn-login" :disabled="cargando">
          {{ cargando ? 'Ingresando...' : 'Iniciar Sesión' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiService } from '../services/api';

const router = useRouter();
const usuario = ref('');
const password = ref('');
const error = ref('');
const cargando = ref(false);

const iniciarSesion = async () => {
  error.value = '';
  cargando.value = true;
  try {
    const res = await apiService.login(usuario.value, password.value);
    const { token, usuario: nombreUsuario, empresas } = res.data;

    localStorage.setItem('token', token);
    localStorage.setItem('usuario', nombreUsuario);
    localStorage.setItem('empresas', JSON.stringify(empresas));

    router.push('/');
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Error al iniciar sesión';
  } finally {
    cargando.value = false;
  }
};
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background: linear-gradient(145deg, #202020 0%, #3a3a38 60%, #4a4a47 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  position: relative;
  overflow: hidden;
}

/* Acento decorativo verde */
.login-page::before {
  content: '';
  position: absolute;
  width: 480px;
  height: 480px;
  background: radial-gradient(circle, rgba(134,187,37,0.18) 0%, transparent 70%);
  top: -100px;
  right: -100px;
  border-radius: 50%;
  pointer-events: none;
}

.login-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 52px 44px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.35);
  position: relative;
  z-index: 1;
}

.login-logo {
  text-align: center;
  margin-bottom: 32px;
}

.login-logo-img {
  width: 220px;
  object-fit: contain;
  display: block;
  margin: 0 auto 14px;
}

.subtitle {
  color: #555652;
  font-size: 13px;
  margin: 0;
  font-weight: 500;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-group label {
  font-size: 12px;
  font-weight: 700;
  color: #555652;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.input-group input {
  padding: 13px 14px;
  border: 1.5px solid #d4d4d0;
  border-radius: 9px;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  font-family: inherit;
  color: #202020;
  background: #fafaf8;
}

.input-group input:focus {
  border-color: #86BB25;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(134, 187, 37, 0.15);
}

.error-msg {
  background: #fff5f5;
  border: 1px solid #ffc9c9;
  color: #c0392b;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 500;
}

.btn-login {
  background: #86BB25;
  color: white;
  border: none;
  border-radius: 9px;
  padding: 15px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
  font-family: inherit;
  margin-top: 6px;
  letter-spacing: 0.02em;
}

.btn-login:hover:not(:disabled) {
  background: #6a9a1e;
  transform: translateY(-1px);
}

.btn-login:active:not(:disabled) { transform: translateY(0); }

.btn-login:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
