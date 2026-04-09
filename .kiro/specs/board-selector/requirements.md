# Requirements Document

## Introduction

Este documento define os requisitos para o Board Selector (Seletor de Placas) no Rusteon IDE, uma aplicação Tauri que combina backend Rust com frontend React/TypeScript. O Board Selector implementa o fluxo básico de UI para seleção de placas: o usuário clica em "Select Board", seleciona uma porta serial, e então vê um diálogo de seleção de placas. Por enquanto, a lista de placas estará vazia, pois o Board Manager ainda não foi implementado.

## Glossary

- **Board_Selector_Button**: Botão ou dropdown na toolbar que inicia o fluxo de seleção de placa
- **Serial_Port_Dialog**: Diálogo que permite ao usuário selecionar uma porta serial
- **Board_Selection_Dialog**: Diálogo que exibe a lista de placas disponíveis para seleção
- **Frontend_Component**: Componente React/TypeScript que renderiza a interface do usuário
- **IDE_Store**: Store Zustand que gerencia o estado global da aplicação
- **Serial_Port**: Porta de comunicação serial (ex: COM3, /dev/ttyUSB0) usada para conectar à placa
- **Selected_Port**: Porta serial atualmente selecionada pelo usuário
- **Board_List**: Lista de placas disponíveis (vazia nesta implementação inicial)

## Requirements

### Requirement 1: Exibir Botão de Seleção de Placa

**User Story:** Como desenvolvedor, eu quero ver um botão "Select Board" na toolbar, para que eu possa iniciar o processo de seleção de placa.

#### Acceptance Criteria

1. THE Frontend_Component SHALL renderizar um Board_Selector_Button na toolbar do IDE
2. THE Board_Selector_Button SHALL exibir o texto "Select Board"
3. THE Board_Selector_Button SHALL exibir um ícone de placa para identificação visual
4. THE Frontend_Component SHALL aplicar estilos consistentes com o design existente do IDE
5. THE Board_Selector_Button SHALL ser visível e clicável em todos os estados da aplicação

### Requirement 2: Abrir Diálogo de Seleção de Porta Serial

**User Story:** Como desenvolvedor, eu quero selecionar uma porta serial primeiro, para que o sistema saiba onde a placa está conectada.

#### Acceptance Criteria

1. WHEN o usuário clica no Board_Selector_Button, THE Frontend_Component SHALL abrir o Serial_Port_Dialog
2. THE Serial_Port_Dialog SHALL exibir uma lista de portas seriais disponíveis no sistema
3. THE Serial_Port_Dialog SHALL permitir ao usuário selecionar uma porta da lista
4. THE Serial_Port_Dialog SHALL incluir botões "Cancel" e "OK"
5. WHEN o usuário clica em "Cancel", THE Serial_Port_Dialog SHALL fechar sem prosseguir

### Requirement 3: Obter Lista de Portas Seriais

**User Story:** Como desenvolvedor, eu quero ver as portas seriais disponíveis no meu sistema, para que eu possa escolher a porta correta.

#### Acceptance Criteria

1. WHEN o Serial_Port_Dialog é aberto, THE Frontend_Component SHALL solicitar a lista de portas seriais disponíveis
2. THE Frontend_Component SHALL exibir cada porta com seu nome (ex: COM3, /dev/ttyUSB0)
3. IF nenhuma porta serial estiver disponível, THEN THE Serial_Port_Dialog SHALL exibir mensagem "Nenhuma porta serial encontrada"
4. THE Serial_Port_Dialog SHALL exibir um indicador de loading enquanto carrega as portas
5. IF houver erro ao obter as portas, THEN THE Serial_Port_Dialog SHALL exibir mensagem de erro

### Requirement 4: Abrir Diálogo de Seleção de Placa

**User Story:** Como desenvolvedor, eu quero ver um diálogo de seleção de placas após escolher a porta serial, para que eu possa selecionar a placa apropriada.

#### Acceptance Criteria

1. WHEN o usuário seleciona uma porta e clica em "OK" no Serial_Port_Dialog, THE Frontend_Component SHALL fechar o Serial_Port_Dialog
2. THE Frontend_Component SHALL abrir o Board_Selection_Dialog imediatamente após fechar o Serial_Port_Dialog
3. THE Board_Selection_Dialog SHALL exibir o título "Select Board"
4. THE Board_Selection_Dialog SHALL incluir botões "Cancel" e "OK"
5. WHEN o usuário clica em "Cancel", THE Board_Selection_Dialog SHALL fechar sem fazer alterações

### Requirement 5: Exibir Lista Vazia de Placas

**User Story:** Como desenvolvedor, eu quero ver uma mensagem informativa quando não há placas disponíveis, para que eu entenda que preciso instalar placas via Board Manager.

#### Acceptance Criteria

1. THE Board_Selection_Dialog SHALL exibir uma lista vazia de placas
2. THE Board_Selection_Dialog SHALL exibir a mensagem "Nenhuma placa disponível"
3. THE Board_Selection_Dialog SHALL exibir texto orientativo "Instale placas usando o Board Manager"
4. THE Board_Selection_Dialog SHALL desabilitar o botão "OK" quando nenhuma placa está selecionada
5. THE Board_Selection_Dialog SHALL manter layout e espaçamento apropriados mesmo com lista vazia

### Requirement 6: Gerenciar Estado da Porta Serial Selecionada

**User Story:** Como desenvolvedor, eu quero que a porta serial selecionada seja armazenada, para que o sistema lembre da minha escolha.

#### Acceptance Criteria

1. WHEN o usuário seleciona uma porta no Serial_Port_Dialog, THE IDE_Store SHALL armazenar a Selected_Port
2. THE IDE_Store SHALL fornecer uma função para ler a Selected_Port
3. THE IDE_Store SHALL fornecer uma função para atualizar a Selected_Port
4. WHEN a Selected_Port muda, THE IDE_Store SHALL disparar re-renderização dos componentes dependentes
5. THE IDE_Store SHALL inicializar Selected_Port como null quando nenhuma porta foi selecionada

### Requirement 7: Fechar Diálogos Corretamente

**User Story:** Como desenvolvedor, eu quero que os diálogos fechem corretamente, para que a interface não fique em estado inconsistente.

#### Acceptance Criteria

1. WHEN o usuário clica fora do diálogo, THE Frontend_Component SHALL fechar o diálogo ativo
2. WHEN o usuário pressiona a tecla Escape, THE Frontend_Component SHALL fechar o diálogo ativo
3. WHEN um diálogo é fechado via "Cancel", THE Frontend_Component SHALL descartar quaisquer seleções temporárias
4. THE Frontend_Component SHALL garantir que apenas um diálogo esteja aberto por vez
5. WHEN o Board_Selection_Dialog é fechado, THE Frontend_Component SHALL limpar o estado temporário de seleção

### Requirement 8: Acessibilidade dos Diálogos

**User Story:** Como desenvolvedor com necessidades de acessibilidade, eu quero que os diálogos sejam acessíveis via teclado, para que eu possa usar o IDE sem mouse.

#### Acceptance Criteria

1. THE Serial_Port_Dialog SHALL ser navegável via tecla Tab
2. THE Board_Selection_Dialog SHALL ser navegável via tecla Tab
3. WHEN um diálogo tem foco, THE Frontend_Component SHALL exibir indicador visual de foco
4. THE Frontend_Component SHALL permitir navegação entre itens da lista com teclas de seta
5. THE Frontend_Component SHALL incluir atributos ARIA apropriados para leitores de tela

### Requirement 9: Tratamento de Erros na Obtenção de Portas

**User Story:** Como desenvolvedor, eu quero ser informado quando houver problemas ao obter as portas seriais, para que eu possa tomar ações corretivas.

#### Acceptance Criteria

1. IF houver erro ao obter portas seriais, THEN THE Serial_Port_Dialog SHALL exibir mensagem de erro descritiva
2. THE Serial_Port_Dialog SHALL incluir botão "Retry" quando houver erro
3. WHEN o usuário clica em "Retry", THE Frontend_Component SHALL tentar obter as portas novamente
4. THE Serial_Port_Dialog SHALL exibir indicador de loading durante retry
5. IF o retry falhar, THEN THE Serial_Port_Dialog SHALL exibir a mensagem de erro novamente

### Requirement 10: Indicadores Visuais de Estado

**User Story:** Como desenvolvedor, eu quero ver indicadores visuais claros do estado atual, para que eu entenda o que está acontecendo no sistema.

#### Acceptance Criteria

1. THE Serial_Port_Dialog SHALL exibir spinner de loading enquanto carrega portas seriais
2. THE Board_Selection_Dialog SHALL exibir ícone informativo junto à mensagem de lista vazia
3. THE Frontend_Component SHALL desabilitar visualmente botões que não podem ser clicados
4. THE Frontend_Component SHALL destacar visualmente o item selecionado nas listas
5. THE Frontend_Component SHALL usar cores e ícones consistentes com o design system do IDE
