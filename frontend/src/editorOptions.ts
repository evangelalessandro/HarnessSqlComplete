// Opzioni condivise dell'editor SQL.

/**
 * Separatori di parola dell'editor.
 *
 * Monaco usa QUESTA lista (non il wordPattern del linguaggio) per il doppio click,
 * per Ctrl+freccia e per la selezione della parola. L'elenco predefinito contiene '@' e
 * '#', quindi un doppio click su "@var" selezionava solo "var" e su "#tmp" solo "tmp".
 * In T-SQL però '@' e '#' fanno parte del nome: variabili e parametri (@p1), funzioni di
 * sistema (@@ROWCOUNT), tabelle temporanee (#tmp, ##globale). Qui si tolgono quindi dalla
 * lista, lasciando invariati tutti gli altri separatori predefiniti:
 *   predefiniti: `~!@#$%^&*()-=+[{]}\|;:'",.<>/?
 */
export const SQL_WORD_SEPARATORS = '`~!$%^&*()-=+[{]}\\|;:\'",.<>/?'
