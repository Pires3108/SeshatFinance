# Seshat Finance — Matriz de permissões

## 1. Premissas

- A matriz familiar pertence a uma fase posterior, mas orienta a autorização desde o início.
- Permissões são verificadas no servidor.
- Contas individuais são visíveis e editáveis apenas por seu titular.
- O proprietário transfere a propriedade antes de sair; ninguém pode removê-lo.
- O observador nunca cria, altera, importa, exporta ou exclui dados compartilhados.

## 2. Permissões no grupo familiar

| Capacidade                                  | Proprietário |      Administrador       |     Membro     | Observador |
| ------------------------------------------- | :----------: | :----------------------: | :------------: | :--------: |
| Ver dados compartilhados                    |     Sim      |           Sim            |      Sim       |    Sim     |
| Criar ou editar movimentação compartilhada  |     Sim      |           Sim            |      Sim       |    Não     |
| Enviar movimentação compartilhada à lixeira |     Sim      |           Sim            |      Sim       |    Não     |
| Restaurar item compartilhado                |     Sim      |           Sim            |      Sim       |    Não     |
| Purgar item compartilhado                   |     Sim      |           Sim            |      Não       |    Não     |
| Criar ou editar conta compartilhada         |     Sim      |           Sim            |      Sim       |    Não     |
| Arquivar conta compartilhada                |     Sim      |           Sim            |      Não       |    Não     |
| Criar metas, orçamentos e cenários          |     Sim      |           Sim            |      Sim       |    Não     |
| Importar para conta compartilhada           |     Sim      |           Sim            |      Sim       |    Não     |
| Reverter importação compartilhada           |     Sim      |           Sim            |      Não       |    Não     |
| Exportar dados compartilhados               |     Sim      |           Sim            |      Sim       |    Não     |
| Ver auditoria compartilhada                 |     Sim      |           Sim            | Próprias ações |    Não     |
| Convidar participante                       |     Sim      |           Sim            |      Não       |    Não     |
| Remover membro ou observador                |     Sim      |           Sim            |      Não       |    Não     |
| Promover ou rebaixar membro ou observador   |     Sim      |           Sim            |      Não       |    Não     |
| Promover administrador                      |     Sim      |           Não            |      Não       |    Não     |
| Remover ou rebaixar administrador           |     Sim      | Sim, exceto proprietário |      Não       |    Não     |
| Alterar configurações do grupo              |     Sim      |           Sim            |      Não       |    Não     |
| Transferir propriedade                      |     Sim      |           Não            |      Não       |    Não     |
| Excluir o grupo                             |     Sim      |           Não            |      Não       |    Não     |

## 3. Regras complementares

1. Administrador não remove, rebaixa ou substitui o proprietário.
2. O último proprietário não pode sair do grupo.
3. Exportação de membro nunca inclui dados individuais de terceiros.
4. Mudanças de papel, convites, remoções e exportações são auditados.
5. Remoção de participante revoga acesso imediatamente.
6. Registros do participante removido conservam autoria histórica de modo compatível com a privacidade.
7. Proprietário ou administrador pode definir o papel Administrador no convite. Promover um participante existente a Administrador exige Proprietário; a transferência de propriedade é uma operação separada.
8. A alteração de papel revalida autor e participante na gravação e produz auditoria imutável; repetir a alteração para o papel já vigente não cria outro evento.
