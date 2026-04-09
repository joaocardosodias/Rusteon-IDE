# Plano de Implementação: Board Selector

## Visão Geral

Implementar o fluxo de seleção de placas no Rusteon IDE, incluindo botão na toolbar, diálogo de seleção de porta serial, diálogo de seleção de placa (com lista vazia inicial), e integração com backend Rust/Tauri para obter portas seriais do sistema.

## Tarefas

- [x] 1. Configurar backend Rust para enumerar portas seriais
  - [x] 1.1 Adicionar dependência serialport ao Cargo.toml
    - Adicionar `serialport = "4.5"` nas dependências
    - _Requisitos: 3.1, 3.2_
  
  - [x] 1.2 Implementar comando Tauri get_serial_ports
    - Criar função `get_serial_ports` em `src-tauri/src/lib.rs`
    - Usar `serialport::available_ports()` para enumerar portas
    - Retornar `Result<Vec<String>, String>` com nomes das portas
    - Tratar erros de permissão e sistema operacional
    - _Requisitos: 3.1, 3.2, 9.1, 9.2_

- [x] 2. Estender Zustand store com estado do board selector
  - [x] 2.1 Adicionar tipos TypeScript para board selector
    - Criar arquivo `src/types/board-selector.ts`
    - Definir interfaces para estado e props dos componentes
    - _Requisitos: 6.1, 6.2, 6.3_
  
  - [x] 2.2 Adicionar estado e ações ao useIDEStore
    - Adicionar `serialDialogOpen`, `boardDialogOpen`, `selectedPort`, `selectedBoard` ao estado
    - Implementar actions: `setSerialDialogOpen`, `setBoardDialogOpen`, `setSelectedPort`, `setSelectedBoard`
    - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 3. Implementar componente SerialPortDialog
  - [x] 3.1 Criar estrutura base do SerialPortDialog
    - Criar arquivo `src/components/SerialPortDialog.tsx`
    - Implementar componente com props (open, onClose, onPortSelected)
    - Usar shadcn/ui Dialog como base
    - _Requisitos: 2.1, 2.3, 2.4_
  
  - [x] 3.2 Implementar carregamento de portas seriais
    - Chamar `invoke("get_serial_ports")` ao montar o componente
    - Gerenciar estados: loading, error, ports
    - Exibir spinner durante carregamento
    - _Requisitos: 3.1, 3.4, 10.1_
  
  - [x] 3.3 Implementar lista de portas e seleção
    - Renderizar lista de portas com radio buttons ou lista clicável
    - Permitir seleção de uma porta
    - Destacar visualmente item selecionado
    - _Requisitos: 2.2, 2.3, 10.4_
  
  - [x] 3.4 Implementar tratamento de erros e retry
    - Exibir mensagem de erro quando falha ao obter portas
    - Adicionar botão "Retry" em caso de erro
    - Implementar lógica de retry
    - Exibir mensagem quando nenhuma porta está disponível
    - _Requisitos: 3.3, 3.5, 9.1, 9.2, 9.3, 9.4, 9.5_
  
  - [x] 3.5 Implementar botões de ação e fechamento
    - Adicionar botões "Cancel" e "OK"
    - Habilitar "OK" apenas quando porta está selecionada
    - Implementar fechamento via Escape e clique fora
    - Chamar onPortSelected ao confirmar
    - _Requisitos: 2.4, 2.5, 7.1, 7.2, 7.3_
  
  - [x] 3.6 Implementar acessibilidade do diálogo
    - Adicionar atributos ARIA (role, aria-modal, aria-labelledby)
    - Implementar navegação por teclado (Tab, setas)
    - Adicionar focus trap
    - Exibir indicadores visuais de foco
    - _Requisitos: 8.1, 8.3, 8.4, 8.5_

- [x] 4. Implementar componente BoardSelectionDialog
  - [x] 4.1 Criar estrutura base do BoardSelectionDialog
    - Criar arquivo `src/components/BoardSelectionDialog.tsx`
    - Implementar componente com props (open, onClose, onBoardSelected)
    - Usar shadcn/ui Dialog como base
    - _Requisitos: 4.1, 4.2, 4.3, 4.4_
  
  - [x] 4.2 Implementar exibição de lista vazia
    - Renderizar lista vazia de placas
    - Exibir mensagem "Nenhuma placa disponível"
    - Exibir texto orientativo "Instale placas usando o Board Manager"
    - Adicionar ícone informativo
    - _Requisitos: 5.1, 5.2, 5.3, 10.2_
  
  - [x] 4.3 Implementar botões de ação
    - Adicionar botões "Cancel" e "OK"
    - Desabilitar botão "OK" (nenhuma placa selecionada)
    - Implementar fechamento via Escape e clique fora
    - _Requisitos: 4.4, 4.5, 5.4, 7.1, 7.2, 7.5_
  
  - [x] 4.4 Implementar acessibilidade do diálogo
    - Adicionar atributos ARIA apropriados
    - Implementar navegação por teclado
    - Adicionar focus trap
    - _Requisitos: 8.2, 8.3, 8.5_

- [x] 5. Implementar componente BoardSelectorButton
  - [x] 5.1 Criar componente BoardSelectorButton
    - Criar arquivo `src/components/BoardSelectorButton.tsx`
    - Renderizar botão com ícone de placa e texto "Select Board"
    - Aplicar estilos consistentes com toolbar existente
    - _Requisitos: 1.1, 1.2, 1.3, 1.4_
  
  - [x] 5.2 Integrar com Zustand store
    - Conectar ao useIDEStore
    - Chamar `setSerialDialogOpen(true)` ao clicar
    - _Requisitos: 1.5, 2.1_

- [x] 6. Integrar componentes na IDELayout
  - [x] 6.1 Adicionar BoardSelectorButton à toolbar
    - Modificar `src/components/IDELayout.tsx`
    - Adicionar BoardSelectorButton na posição apropriada da toolbar
    - _Requisitos: 1.1, 1.5_
  
  - [x] 6.2 Adicionar diálogos condicionais à IDELayout
    - Renderizar SerialPortDialog quando `serialDialogOpen` é true
    - Renderizar BoardSelectionDialog quando `boardDialogOpen` é true
    - Garantir que apenas um diálogo esteja aberto por vez
    - _Requisitos: 2.1, 4.1, 7.4_
  
  - [x] 6.3 Implementar fluxo completo de seleção
    - Conectar onPortSelected do SerialPortDialog ao store e abertura do BoardSelectionDialog
    - Implementar transição: fechar SerialPortDialog → abrir BoardSelectionDialog
    - Limpar estado temporário ao fechar diálogos
    - _Requisitos: 4.1, 4.2, 6.4, 7.3, 7.5_

- [x] 7. Checkpoint - Garantir que tudo funciona
  - Testar fluxo completo: clicar botão → selecionar porta → ver diálogo de placas
  - Verificar tratamento de erros e retry
  - Testar navegação por teclado e acessibilidade
  - Garantir que todos os testes passam, perguntar ao usuário se há dúvidas

## Notas

- Projeto usa React 19.1.0, TypeScript 5.8.3, Zustand 5.0.12, Tailwind CSS 4.2.2
- Backend usa Rust com Tauri 2.x
- Seguir padrões de estilo existentes do IDE
- Lista de placas estará vazia nesta implementação (Board Manager será implementado futuramente)
- Todos os textos devem estar em português
- Usar shadcn/ui para componentes de diálogo
- Garantir acessibilidade completa (ARIA, navegação por teclado, focus trap)
