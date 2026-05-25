const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();

// ─── Middlewares ────────────────────────────────────────────────────────────
app.use(express.json());
// Serve todos os arquivos HTML/CSS da pasta atual
app.use(express.static(path.join(__dirname)));

// ─── Conexão com MongoDB ─────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Erro MongoDB:', err));
// ─── Schema e Model do Usuário ────────────────────────────────────────────────
/*
  Aqui definimos a "estrutura" dos documentos que vão existir
  na coleção "usuarios" dentro do banco "finplan".
  
  O Mongoose usa isso para validar e salvar os dados.
*/
const usuarioSchema = new mongoose.Schema({
    nome:  { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    senha: { type: String, required: true },
    criadoEm: { type: Date, default: Date.now }
});

const Usuario = mongoose.model('Usuario', usuarioSchema);

// ─── Função de validação de senha ────────────────────────────────────────────
function validarSenha(senha) {
    if (senha.length < 7)              return 'Senha precisa ter ao menos 7 caracteres.';
    if (!/[A-Z]/.test(senha))          return 'Senha precisa ter ao menos uma letra maiúscula.';
    if (!/[0-9]/.test(senha))          return 'Senha precisa ter ao menos um número.';
    if (!/[^a-zA-Z0-9]/.test(senha))   return 'Senha precisa ter ao menos um símbolo (!@#$%...).';
    return null; // null = sem erro
}

// ─── Rota: POST /cadastro ────────────────────────────────────────────────────
/*
  Recebe: { nome, email, senha }
  - Valida os campos
  - Verifica se email já existe
  - Salva no MongoDB
  
  ATENÇÃO: Em produção real, você DEVE usar bcrypt para
  criptografar a senha antes de salvar. Por ora, salvamos
  em texto puro para facilitar o aprendizado.
*/
app.post('/cadastro', async (req, res) => {
    const { nome, email, senha } = req.body;

    // 1. Validação básica dos campos
    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Todos os campos são obrigatórios.' });
    }

    // 2. Validação da senha (mesmas regras do front-end, mas no servidor)
    const erroSenha = validarSenha(senha);
    if (erroSenha) {
        return res.status(400).json({ erro: erroSenha });
    }

    try {
        // 3. Verifica se e-mail já está cadastrado
        const existe = await Usuario.findOne({ email });
        if (existe) {
            return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
        }

        // 4. Cria e salva o novo usuário
        const novoUsuario = new Usuario({ nome, email, senha });
        await novoUsuario.save();

        console.log(`✅ Usuário cadastrado: ${email}`);
        return res.status(201).json({ mensagem: 'Conta criada com sucesso!' });

    } catch (err) {
        console.error('Erro no cadastro:', err);
        return res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
    }
});

// ─── Rota: POST /login ───────────────────────────────────────────────────────
/*
  Recebe: { email, senha }
  - Busca o usuário pelo email
  - Compara a senha
  - Retorna os dados do usuário (sem a senha!)
*/
app.post('/login', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ erro: 'Preencha e-mail e senha.' });
    }

    try {
        // Busca o usuário no banco pelo email
        const usuario = await Usuario.findOne({ email });

        // Se não achou OU a senha não bate → mesmo erro (não revela qual está errado)
        if (!usuario || usuario.senha !== senha) {
            return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
        }

        console.log(`✅ Login: ${email}`);

        // Retorna o nome para o front-end exibir no dashboard
        return res.status(200).json({
            mensagem: 'Login realizado com sucesso!',
            nome: usuario.nome
        });

    } catch (err) {
        console.error('Erro no login:', err);
        return res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
    }
});

// ─── Rota: GET /dashboard.html ───────────────────────────────────────────────
// Já servida pelo express.static, mas garantimos o caminho
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ─── Inicializa o servidor ───────────────────────────────────────────────────
const PORTA = 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORTA}`);
    console.log(`   → Login:    http://localhost:${PORTA}/login.html`);
    console.log(`   → Cadastro: http://localhost:${PORTA}/cadastro.html`);
});
