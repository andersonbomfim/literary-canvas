export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 text-foreground">
      <h1 className="font-display text-3xl mb-6">Termos de Uso</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Última atualização: {new Date().toLocaleDateString("pt-BR")}
      </p>

      <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            1. Aceitacao dos Termos
          </h2>
          <p>
            Ao acessar e usar o Literary Canvas, você concorda com estes Termos
            de Uso. Se não concordar, não utilize a plataforma.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            2. Descrição do Serviço
          </h2>
          <p>
            O Literary Canvas e uma plataforma de escrita assistida por
            inteligencia artificial que auxilia autores na criação, organização
            e desenvolvimento de obras literárias.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            3. Conta do Usuario
          </h2>
          <p>
            Você é responsavel por manter a segurança de sua conta e senha.
            Atividades realizadas sob sua conta são de sua responsabilidade.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            4. Propriedade Intelectual
          </h2>
          <p>
            Todo o conteúdo criado por você na plataforma permanece como sua
            propriedade intelectual. O Literary Canvas não reivindica direitos
            sobre textos, personagens, histórias ou qualquer conteúdo literário
            produzido pelos usuários, seja com ou sem assistência de IA.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            5. Uso de Crditos
          </h2>
          <p>
            Funcionalidades de geração de conteúdo via IA consomem créditos de
            sua conta. Créditos consumidos não são reembolsáveis, exceto em caso
            de falha técnica comprovada.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            6. Uso Aceitavel
          </h2>
          <p>
            Você concorda em não utilizar a plataforma para gerar conteúdo
            ilegal, difamatório, que viole direitos de terceiros, ou que promova
            violência ou discriminação.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            7. Limitacao de Responsabilidade
          </h2>
          <p>
            O Literary Canvas ? fornecido "como está". Não garantimos
            disponibilidade ininterrupta ou que o conteúdo gerado por IA seja
            livre de erros ou inconsistncias.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            8. Alteracoes nos Termos
          </h2>
          <p>
            Podemos atualizar estes termos periodicamente. Continuando a usar a
            plataforma apos alterações, você aceita os novos termos.
          </p>
        </section>
      </div>
    </div>
  );
}
