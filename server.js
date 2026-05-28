const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Conexão MongoDB ───────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://<usuario>:<senha>@cluster0.yvqlecc.mongodb.net/finplan?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB conectado'))
  .catch(err => { console.error('❌ Erro ao conectar MongoDB:', err); process.exit(1); });

// ── Schemas e Models ──────────────────────────────────────────────

// -- Usuário
const usuarioSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  senha: {
    type: String,
    required: true,
  },
  criadoEm: {
    type: Date,
    default: Date.now,
  },
});

const Usuario = mongoose.model('Usuario', usuarioSchema);

// -- Dados Financeiros (um por usuário)
const contaSchema = new mongoose.Schema({
  nome:  { type: String, required: true, trim: true },
  valor: { type: Number, required: true, min: 0 },
});

const dadosFinanceirosSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true,
    unique: true,           // 1 documento por usuário
  },
  salario:     { type: Number, required: true, min: 0 },
  gastosFixos: { type: Number, required: true, min: 0 },
  contas:      [contaSchema],
  objetivo:    { type: String, trim: true },
  tempoPrazo:  { type: Number, min: 1 },   // meses
  investimento:{ type: Number, min: 0 },   // valor mensal a investir
  atualizadoEm: { type: Date, default: Date.now },
});

const DadosFinanceiros = mongoose.model('DadosFinanceiros', dadosFinanceirosSchema);

// ── Helpers ───────────────────────────────────────────────────────

/** Valida a senha conforme as regras do sistema */
function validarSenha(senha) {
  if (!senha || senha.length < 7)          return 'A senha deve ter pelo menos 7 caracteres.';
  if (!/[A-Z]/.test(senha))               return 'A senha deve conter pelo menos 1 letra maiúscula.';
  if (!/[0-9]/.test(senha))               return 'A senha deve conter pelo menos 1 número.';
  if (!/[^A-Za-z0-9]/.test(senha))        return 'A senha deve conter pelo menos 1 símbolo (ex: @, #, !).';
  return null; // válida
}

// ── Rotas de Autenticação ─────────────────────────────────────────

/**
 * POST /cadastro
 * Body: { email, senha }
 * Cria um novo usuário se o e-mail ainda não existir.
 */
app.post('/cadastro', async (req, res) => {
  try {
    const { email, senha } = req.body;

    // Validações básicas
    if (!email || !senha) {
      return res.status(400).json({ mensagem: 'E-mail e senha são obrigatórios.' });
    }

    // Validação de senha
    const erroSenha = validarSenha(senha);
    if (erroSenha) return res.status(400).json({ mensagem: erroSenha });

    // Verifica e-mail duplicado
    const existe = await Usuario.findOne({ email: email.toLowerCase().trim() });
    if (existe) {
      return res.status(409).json({ mensagem: 'Este e-mail já está cadastrado.' });
    }

    // Hash da senha (custo 12)
    const hash = await bcrypt.hash(senha, 12);

    const usuario = new Usuario({ email, senha: hash });
    await usuario.save();

    return res.status(201).json({
      mensagem: 'Cadastro realizado com sucesso!',
      userId: usuario._id,
      email:  usuario.email,
    });
  } catch (err) {
    console.error('Erro em /cadastro:', err);
    return res.status(500).json({ mensagem: 'Erro interno no servidor.' });
  }
});

/**
 * POST /login
 * Body: { email, senha }
 * Autentica o usuário e informa se ele já tem dados financeiros.
 */
app.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ mensagem: 'E-mail e senha são obrigatórios.' });
    }

    // Busca usuário
    const usuario = await Usuario.findOne({ email: email.toLowerCase().trim() });
    if (!usuario) {
      return res.status(401).json({ mensagem: 'E-mail ou senha incorretos.' });
    }

    // Compara senha
    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
    if (!senhaCorreta) {
      return res.status(401).json({ mensagem: 'E-mail ou senha incorretos.' });
    }

    // Verifica se já tem dados financeiros cadastrados
    const temDados = await DadosFinanceiros.exists({ userId: usuario._id });

    return res.status(200).json({
      mensagem: 'Login realizado com sucesso!',
      userId:   usuario._id,
      email:    usuario.email,
      hasData:  !!temDados,   // front usa isso para decidir para onde redirecionar
    });
  } catch (err) {
    console.error('Erro em /login:', err);
    return res.status(500).json({ mensagem: 'Erro interno no servidor.' });
  }
});

// ── Rotas de Dados Financeiros ────────────────────────────────────

/**
 * POST /dados-financeiros
 * Body: { userId, salario, gastosFixos, contas, objetivo, tempoPrazo, investimento }
 * Cria ou atualiza os dados financeiros do usuário (upsert).
 */
app.post('/dados-financeiros', async (req, res) => {
  try {
    const { userId, salario, gastosFixos, contas, objetivo, tempoPrazo, investimento } = req.body;

    // Validações mínimas
    if (!userId)                    return res.status(400).json({ mensagem: 'userId é obrigatório.' });
    if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ mensagem: 'userId inválido.' });
    if (typeof salario !== 'number' || salario < 0)
                                    return res.status(400).json({ mensagem: 'Salário inválido.' });
    if (!Array.isArray(contas) || contas.length === 0)
                                    return res.status(400).json({ mensagem: 'Informe ao menos uma conta.' });

    // Valida cada conta
    for (const c of contas) {
      if (!c.nome || typeof c.valor !== 'number' || c.valor < 0) {
        return res.status(400).json({ mensagem: `Conta inválida: "${c.nome || 'sem nome'}"` });
      }
    }

    // Upsert — cria se não existe, atualiza se já existe
    const dados = await DadosFinanceiros.findOneAndUpdate(
      { userId },
      {
        salario,
        gastosFixos: gastosFixos || 0,
        contas,
        objetivo:   objetivo || '',
        tempoPrazo: tempoPrazo || 12,
        investimento: investimento || 0,
        atualizadoEm: new Date(),
      },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({
      mensagem: 'Dados financeiros salvos com sucesso!',
      dados,
    });
  } catch (err) {
    console.error('Erro em POST /dados-financeiros:', err);
    return res.status(500).json({ mensagem: 'Erro interno no servidor.' });
  }
});

/**
 * GET /dados-financeiros/:userId
 * Retorna os dados financeiros do usuário.
 * Responde 404 se ainda não existirem.
 */
app.get('/dados-financeiros/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ mensagem: 'userId inválido.' });
    }

    const dados = await DadosFinanceiros.findOne({ userId });
    if (!dados) {
      return res.status(404).json({ mensagem: 'Dados financeiros não encontrados para este usuário.' });
    }

    return res.status(200).json(dados);
  } catch (err) {
    console.error('Erro em GET /dados-financeiros:', err);
    return res.status(500).json({ mensagem: 'Erro interno no servidor.' });
  }
});

// ── Rota de Reset ─────────────────────────────────────────────────

/**
 * POST /reset-dados
 * Body: { userId, senha }
 * Exige a senha do usuário para deletar os dados financeiros.
 */
app.post('/reset-dados', async (req, res) => {
  try {
    const { userId, senha } = req.body;

    if (!userId || !senha) {
      return res.status(400).json({ mensagem: 'userId e senha são obrigatórios.' });
    }

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ mensagem: 'userId inválido.' });
    }

    // Busca usuário para verificar a senha
    const usuario = await Usuario.findById(userId);
    if (!usuario) {
      return res.status(404).json({ mensagem: 'Usuário não encontrado.' });
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
    if (!senhaCorreta) {
      return res.status(401).json({ mensagem: 'Senha incorreta. Não foi possível realizar o reset.' });
    }

    // Deleta os dados financeiros (o usuário em si permanece)
    await DadosFinanceiros.deleteOne({ userId });

    return res.status(200).json({ mensagem: 'Dados financeiros resetados com sucesso!' });
  } catch (err) {
    console.error('Erro em /reset-dados:', err);
    return res.status(500).json({ mensagem: 'Erro interno no servidor.' });
  }
});

// ── Fallback para páginas HTML ────────────────────────────────────
// (se você usar SPA ou quiser redirecionar rotas desconhecidas)
// CORRETO para Express 5:
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// ── Start ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
