export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      <h1 className="font-display text-3xl mb-6">Politica de Privacidade</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Última atualização: {new Date().toLocaleDateString("pt-BR")}
      </p>

      <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            1. Dados Coletados
          </h2>
          <p>
            Coletamos os seguintes dados pessoais: nome, e-mail, e dados de uso
            da plataforma (obras criadas, histórico de geração, consumo de
            créditos). Dados de pagamento são processados por terceiros e não
            armazenados em nossos servidores.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            2. Base Legal (LGPD)
          </h2>
          <p>
            Os dados são tratados com base no consentimento do titular (Art. 7º,
            I da LGPD) e na execução de contrato (Art. 7º, V da LGPD). Você pode
            revogar o consentimento a qualquer momento, exceto para dados
            necessários à prestação do serviço.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            3. Finalidade do Tratamento
          </h2>
          <p>
            Seus dados são usados para: fornecer o serviço de escrita assistida,
            manter o histórico de verses, personalizar a experiencia de escrita,
            processar pagamentos e créditos, e enviar comunicacoes sobre o
            serviço.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            4. Compartilhamento de Dados
          </h2>
          <p>
            Não vendemos seus dados. Compartilhamos apenas com provedores de
            infraestrutura (hospedagem, banco de dados) e provedores de IA (para
            geração de conteúdo). O conteúdo enviado para IA ? usado
            exclusivamente para gerar a resposta solicitada.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            5. Seus Direitos (LGPD Art. 18)
          </h2>
          <p>
            Você tem direito a: confirmar a existência de tratamento, acessar
            seus dados, corrigir dados incompletos ou desatualizados, solicitar
            anonimizacao ou bloqueio de dados desnecessarios, solicitar
            portabilidade, solicitar eliminacao de dados tratados com
            consentimento, e revogar o consentimento.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            6. Retencao de Dados
          </h2>
          <p>
            Seus dados são mantidos enquanto sua conta estiver ativa. Ao excluir
            sua conta, todos os dados pessoais e conteúdo são removidos
            permanentemente em até 30 dias.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            7. Seguranca
          </h2>
          <p>
            Utilizamos criptografia, tokens JWT, hashing de senhas
            (bcrypt/scrypt) e controle de acesso para proteger seus dados.
            Nenhuma transmissão pela internet e 100% segura, mas adotamos as
            melhores práticas de segurança.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            8. Contato do Encarregado de Dados (DPO)
          </h2>
          <p>
            Para exercer seus direitos ou esclarecer dúvidas sobre o tratamento
            de dados, entre em contato pelo e-mail indicado na página de contato
            da plataforma.
          </p>
        </section>
      </div>
    </div>
  );
}
