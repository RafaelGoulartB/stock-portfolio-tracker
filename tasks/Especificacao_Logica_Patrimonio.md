**ESPECIFICAÇÃO FUNCIONAL**

Sistema de Gestão de Patrimônio e Motor de Aportes

Reconstrução da lógica da planilha “Patrimonio.xlsx”

**Objetivo.** Este documento descreve a lógica necessária para reconstruir o sistema fora da planilha, sem depender da posição visual das células. O foco principal é o motor que calcula a prioridade de aporte, consolida Brasil e Exterior, seleciona os ativos e distribui o valor de aporte. Também são documentadas as regras auxiliares, parâmetros, exceções, integrações externas, cálculos de valuation e elementos legados que ainda influenciam o modelo.

| Importante para a migração: algumas fórmulas vieram originalmente do Google Sheets e, no arquivo XLSX, aparecem encapsuladas como DUMMYFUNCTION. A expressão original está preservada dentro do arquivo e foi usada nesta especificação. Valores em cache foram usados apenas para validar o comportamento atual. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 1. Visão geral da arquitetura

| **Componente / aba** | **Função no sistema**                                                                                                          | **Relevância na migração**                                |
|----------------------|--------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------|
| Brasil               | Cadastro e cálculo dos ativos brasileiros, alocação atual, valuation/desconto, nota média e score de aporte.                   | Crítica                                                   |
| Exterior             | Mesma função para ativos internacionais; converte patrimônio em USD para BRL e calcula desconto/score.                         | Crítica                                                   |
| scoreratings         | Tabela de multiplicadores por nota média.                                                                                      | Crítica                                                   |
| TOTAL                | Consolida Brasil + Exterior e ordena os ativos por score decrescente.                                                          | Crítica                                                   |
| aportes              | Transforma o ranking em uma sugestão de compra: seleciona os melhores, distribui o aporte e calcula quantidades/preços/câmbio. | Crítica                                                   |
| Valuation            | Modelo DCF genérico de 10 anos e cálculo de custo de capital.                                                                  | Auxiliar; serve como origem de desconto em outros modelos |
| TOTAL-Old            | Resumo antigo de pesos da carteira; ainda é referenciado por algumas células informativas.                                     | Legado, mas ainda referenciado                            |
| Escriturador         | Mapa de ativos para escrituradores e históricos de notas.                                                                      | Operacional / cadastro                                    |
| EPR                  | Tabela de Equity Risk Premium / Country Risk Premium e taxas corporativas.                                                     | Auxiliar para valuation                                   |
| 2025 - Brasil        | Versão histórica da estrutura de Brasil.                                                                                       | Legado / histórico                                        |

**Fluxo principal de decisão:** Brasil/Exterior → cálculo de % atual, desconto, nota e score → TOTAL ordena por score → aportes pega o topo do ranking → normaliza os scores → converte em valores e quantidades a comprar.

# 2. Modelo de dados por ativo

| **Campo lógico**       | **Origem na planilha** | **Significado**                                                                                                              |
|------------------------|------------------------|------------------------------------------------------------------------------------------------------------------------------|
| target_weight          | Coluna B (%Meta)       | Peso-alvo absoluto do ativo na carteira total. Ex.: 0,03 = 3% do patrimônio total.                                           |
| quantity               | Coluna C (Qtd.Ações)   | Quantidade atual de ações/cotas. Pode ser fracionária no exterior.                                                           |
| current_weight         | Coluna D (%Atual)      | Valor de mercado atual do ativo dividido pelo patrimônio total.                                                              |
| contribution_score     | Coluna E (Score)       | Prioridade quantitativa para receber aporte. Quanto maior, maior prioridade. Pode ficar negativa em uma condição específica. |
| ticker                 | Coluna F (Empresa)     | Identificador do ativo. Tickers terminados em dígito são tratados como ativos B3/Brasil.                                     |
| rating_avg             | Coluna G (Nota.Med)    | Média das até 4 notas trimestrais numéricas mais recentes.                                                                   |
| last_contribution_date | Coluna H (Últ. Aporte) | Data do último aporte; usada como cooldown de 45 dias.                                                                       |
| discount               | Coluna I (Desconto)    | Medida de valuation/desconto. Positivo = ativo abaixo da referência; negativo = acima da referência.                         |
| rating_history         | Colunas trimestrais    | Histórico de notas, do qual são extraídas as 4 observações numéricas mais recentes.                                          |

# 3. Cálculo da alocação atual

## 3.1 Patrimônio total

O denominador usado para transformar a posição de cada ativo em peso de carteira é **aportes!E16**. No arquivo analisado, esse valor está em R\$ 273.000,00. Para o novo sistema, isso deve ser uma variável de configuração ou um patrimônio calculado automaticamente, nunca uma referência de célula.

## 3.2 Ativo brasileiro

current_weight = (market_price_brl × quantity) / total_portfolio_value_brl

Preço de mercado é obtido com GOOGLEFINANCE("BVMF:" + ticker, "price"). Em caso de falha da integração, a planilha mantém um valor em cache por causa do IFERROR do arquivo exportado.

## 3.3 Ativo internacional

current_weight = (market_price_usd × quantity × USD_BRL_spot) / total_portfolio_value_brl

Na apuração da posição existente, o câmbio usado é o dólar à vista de **aportes!D34** (GOOGLEFINANCE("USDBRL")).

## 3.4 Tesouro Selic

current_weight_selic = cash_or_selic_value_brl / total_portfolio_value_brl

A posição de TD.Selic é tratada como valor monetário, não como quantidade × cotação.

# 4. Nota média e multiplicador de qualidade

## 4.1 Nota média

Para cada ativo, o sistema percorre o histórico trimestral, filtra apenas células numéricas, pega no máximo as 4 notas mais recentes e calcula a média simples.

rating_avg = average(last_up_to_4_numeric_ratings)

Se não existir nenhuma nota numérica, o resultado visual é “-”. O sistema novo deve representar isso preferencialmente como null/sem nota, e não como texto em campo numérico.

## 4.2 Tabela de multiplicadores

| **Nota** | **Multiplicador do score** |
|----------|----------------------------|
| 0 a 3    | 0,50×                      |
| 4 a 6    | 0,70×                      |
| 7        | 0,80×                      |
| 8 a 10   | 1,00×                      |

A busca da planilha é aproximada (VLOOKUP com TRUE), portanto notas intermediárias usam o maior limite inferior. Exemplos: 6,67 → 0,70×; 7,50 → 0,80×; 8,33 → 1,00×. Se a busca falhar, o multiplicador padrão é 1,00×.

# 5. Cálculo do desconto / valuation

## 5.1 Conceito

O campo discount é usado para deslocar a meta do ativo antes de comparar com a alocação atual. A meta ajustada é:

adjusted_target = target_weight × (1 + discount)

- discount \> 0: aumenta a meta efetiva e, portanto, tende a elevar o score.

- discount \< 0: reduz a meta efetiva; em excesso de alocação pode gerar score negativo.

## 5.2 Origem do desconto

Há duas formas encontradas na planilha:

- IMPORTRANGE de modelos individuais de valuation, normalmente lendo “Valuation output!C35”.

- Cálculo direto contra um preço-alvo: discount = 1 − market_price / target_price.

discount = 1 - current_price / target_price

Nos ativos internacionais, vários descontos são calculados diretamente por essa segunda forma. No Brasil, muitos ativos importam o resultado de arquivos individuais de valuation.

# 6. Motor de score de aporte

Esta é a regra central do sistema. Para a maioria dos ativos de Brasil e Exterior, o score é calculado em três etapas: excesso de alocação com valuation negativo, travas de elegibilidade e déficit ajustado por qualidade.

## 6.1 Regra geral

if discount \< 0 and current_weight \> target_weight × 1.20:  
score = adjusted_target - current_weight  
else if current_weight \> 0.05  
or current_weight \> target_weight × 1.30  
or (last_contribution_date exists and today - last_contribution_date \< 45 days):  
score = 0  
else:  
raw_gap = max(0, adjusted_target - current_weight)  
score = raw_gap × rating_multiplier

## 6.2 Interpretação econômica

| **Regra**                                    | **Efeito**                                                                                                               |
|----------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| Valuation negativo + posição \> 120% da meta | O score pode ficar negativo. Isso sinaliza excesso de posição em ativo que também está acima da referência de valuation. |
| Peso atual \> 5% da carteira                 | Bloqueia novo aporte, mesmo que a meta/valuation sugerisse mais. É um teto absoluto para os ativos comuns.               |
| Peso atual \> 130% da meta                   | Bloqueia novo aporte por excesso relativo à meta.                                                                        |
| Último aporte há menos de 45 dias            | Bloqueia novo aporte temporariamente (cooldown).                                                                         |
| Déficit positivo e ativo elegível            | O déficit é multiplicado pela nota/qualidade.                                                                            |
| Sem déficit                                  | Score = 0.                                                                                                               |

| Detalhe importante: a primeira condição (discount \< 0 e current_weight \> 120% da meta) é avaliada antes das travas. Portanto ela pode produzir score negativo até mesmo quando current_weight \> 5%. Isso parece intencional para registrar excesso, não para sugerir venda automática. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 6.3 Exceção: TD.Selic

if discount \< 0 and current_weight \> target_weight × 1.20:  
score = adjusted_target - current_weight  
else if current_weight \> 0.50 or current_weight \> target_weight × 1.30:  
score = 0  
else:  
score = max(0, adjusted_target - current_weight)

Diferenças do TD.Selic: não usa nota, não usa cooldown de 45 dias e o teto absoluto é 50% (0,50), em vez de 5% (0,05).

# 7. Alocação-alvo agregada e reguladores Brasil/Exterior

## 7.1 Soma das metas

brazil_target_sum = SUM(Brasil.target_weight) = Brasil!B1

exterior_target_sum = SUM(Exterior.target_weight) = Exterior!B1

risk_assets_target = brazil_target_sum + exterior_target_sum

No arquivo atual, Brasil = 68,75% e Exterior = 25,75%, totalizando 94,50%. O TOTAL-Old mantém esse mesmo total em C6.

## 7.2 Mediana dos descontos

brazil_discount_median = median(discount of configured Brazilian assets)

exterior_discount_median = median(discount of configured international assets)

A planilha usa essas medianas para produzir indicadores de atratividade agregada. Há dois tipos: um ajuste relativo entre regiões e um multiplicador de renda variável.

## 7.3 Ajuste relativo entre Brasil e Exterior

brazil_relative_weight = clamp(0.70 + (brazil_discount_median - exterior_discount_median), 0.20, 0.90)

exterior_relative_weight = 1 - brazil_relative_weight

Esse indicador existe em Brasil!L1 e Exterior!K1. No fluxo de aporte atual, ele não aparece diretamente na fórmula final de compra. Deve ser tratado como indicador auxiliar até decisão explícita de incorporá-lo.

## 7.4 Multiplicador de exposição à renda variável

Brazil:  
if median_discount \> 0.15:  
equity_multiplier_brazil = 1 + (median_discount - 0.15)  
else:  
equity_multiplier_brazil = clamp(base_risk_weight + median_discount, 0, 1)  
  
base_risk_weight = aportes!E22 = 0.85

Exterior:  
if median_discount \> 0.15:  
equity_multiplier_exterior = 1 + (median_discount - 0.15)  
else:  
equity_multiplier_exterior = clamp(0.90 + median_discount, 0, 1)

aggregate_equity_multiplier = (brazil_multiplier × brazil_target_sum + exterior_multiplier × exterior_target_sum) / (brazil_target_sum + exterior_target_sum)

Esse valor é calculado em aportes!D16. Ele representa uma recomendação agregada de quanto do novo dinheiro deveria ir para a parcela de risco, ponderando Brasil e Exterior pelas metas.

| Inconsistência atual: aportes!D16 calcula o multiplicador agregado (~94,29% no cache analisado), porém a célula que efetivamente divide o aporte, aportes!C16, está hardcoded em 100%. B19 usa C16, não D16. Portanto, hoje o motor de compra manda 100% do aporte para “Carteira” e 0% para “Renda Fixa”, apesar de existir uma sugestão dinâmica separada. Na migração, isso precisa ser uma decisão explícita de produto. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 8. Consolidação e ranking global (TOTAL)

A aba TOTAL concatena as colunas B:G das abas Brasil e Exterior e ordena todas as linhas pelo quarto campo desse intervalo, que corresponde ao Score (coluna E original), em ordem decrescente.

combined = concat(Brasil\[B:G\], Exterior\[B:G\])

ranked_assets = rows where target_weight is not null, ORDER BY score DESC

Consequência: o ranking é global. Um ativo brasileiro e um ativo internacional competem diretamente pela mesma fila de prioridade.

| **Campo TOTAL** | **Origem** |
|-----------------|------------|
| B               | %Meta      |
| C               | Quantidade |
| D               | %Atual     |
| E               | Score      |
| F               | Ticker     |
| G               | Nota média |

Os primeiros registros do TOTAL são, portanto, os ativos com maior score positivo. Scores negativos permanecem no fim da lista e não recebem aporte, pois o módulo de aportes aplica MAX(0, score).

# 9. Seleção dos ativos e distribuição do aporte

## 9.1 Universo de compra

A aba aportes lê o ranking TOTAL. A regra ativa distribui o aporte apenas entre os **4 primeiros scores** (TOTAL!E3:E6).

top_score_sum = SUM(maximal 4 scores: TOTAL.E3:E6)

Para cada uma das quatro posições:

normalized_share_i = max(0, score_i / top_score_sum)

Como o denominador é a soma dos quatro scores, as parcelas normalmente somam 100% quando os quatro scores são positivos.

| Há uma fórmula em A8 que ainda verifica “\<= 3” para o quinto candidato, mas o valor fica 0 e os demais candidatos não recebem fração. Isso parece resíduo de uma versão anterior. O comportamento efetivo atual é top 4. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 9.2 Orçamento de aporte

monthly_contribution = aportes!B16

risk_contribution = monthly_contribution × aportes!C16

fixed_income_contribution = monthly_contribution × (1 - aportes!C16)

No arquivo analisado: monthly_contribution = R\$ 5.000; C16 = 100%; portanto risk_contribution = R\$ 5.000 e fixed_income_contribution = R\$ 0.

## 9.3 Valor teórico por ativo

budget_i = risk_contribution × normalized_share_i

# 10. Cotação, quantidade e execução sugerida

## 10.1 Detecção Brasil x exterior

A planilha usa uma heurística simples: se o último caractere do ticker é numérico, o ativo é considerado brasileiro. Exemplos: VULC3, DIRR3, ITUB3. Caso contrário, é considerado internacional: NFLX, DLO, INTR.

| Para um sistema novo, é preferível armazenar explicitamente market/country/currency em vez de inferir pelo último caractere do ticker. A heurística atual funciona para o conjunto presente, mas é frágil para novos instrumentos. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 10.2 Preço usado para compra

if ticker in {TD.Selic, TD.Ipca}:  
execution_price_brl = 1  
else if ticker looks Brazilian:  
execution_price_brl = B3_market_price  
else:  
execution_price_brl = US_market_price_usd × USD_BRL_VET

O câmbio de execução internacional usa **aportes!D35**, que inclui spread e IOF, não apenas o dólar à vista.

USD_BRL_spot = GOOGLEFINANCE("USDBRL")

USD_BRL_VET = USD_BRL_spot × 1.015 × 1.0038

Os parâmetros atuais são spread de 1,5% e IOF de 0,38%.

## 10.3 Quantidade sugerida

if Brazilian ticker:  
quantity_to_buy = floor(budget_i / execution_price_brl)  
else:  
quantity_to_buy = budget_i / execution_price_brl

Isso permite frações no exterior e força unidades inteiras para ativos brasileiros. O total realizado é preço × quantidade.

realized_value_brl = execution_price_brl × quantity_to_buy

international_value_usd = (execution_price_brl / FX_reference) × quantity_to_buy

# 11. Custo internacional e câmbio

| **Variável**  | **Fórmula atual**       | **Interpretação**                                          |
|---------------|-------------------------|------------------------------------------------------------|
| USD_BRL_spot  | GOOGLEFINANCE("USDBRL") | Dólar sem custos.                                          |
| spread_cost   | base_brl × 1,5%         | Spread de câmbio.                                          |
| iof_cost      | base_brl × 0,38%        | IOF.                                                       |
| total_fx_cost | spread_cost + iof_cost  | Custos totais adicionais.                                  |
| USD_BRL_VET   | spot × 1,015 × 1,0038   | Taxa efetiva usada para precificar compras internacionais. |

A planilha também calcula um VET observado a partir de um total em BRL dividido por um total em USD. Esse bloco parece ser conferência operacional, não parte essencial do ranking.

| Inconsistência técnica: algumas fórmulas da coluna F em aportes dividem por D34 (spot) e uma linha específica divide por D35 (VET). Isso altera o valor USD reportado. O sistema novo deve padronizar: use spot para valuation da posição existente; use VET para custo de execução; e guarde separadamente “valor de mercado” e “custo estimado de compra”. |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 12. Modelo DCF da aba Valuation

A aba Valuation contém um DCF genérico de 10 anos. Embora não alimente diretamente todas as linhas de Brasil/Exterior, ela representa a lógica de valuation usada como referência e deve ser migrada como módulo independente se o novo sistema também for substituir os arquivos individuais.

## 12.1 Custo de capital

risk_free_adjusted = (IPCA + real_IPCA_bond_rate) - US_10Y_yield

Ke = risk_free_adjusted + beta × ERP + company_risk + country_risk

WACC = Ke \# no modelo atual, não há ponderação explícita de dívida/capital nesta aba

No modelo analisado, Ke e WACC estão iguais. Kd aparece como rótulo, mas não participa de uma média ponderada de capital no trecho ativo.

## 12.2 Projeção e desconto de FCF

FCF_t = FCF\_(t-1) × (1 + growth_t)

discount_factor_t = 1 / (1 + r)^t

PV_FCF_t = FCF_t × discount_factor_t

PV_explicit_period = SUM(PV_FCF_1 ... PV_FCF_10)

## 12.3 Valor terminal

terminal_value_10 = FCF_10 × (1 + g) / (r - g)

PV_terminal = terminal_value_10 × discount_factor_10

enterprise_value_DCF = PV_explicit_period + PV_terminal

Os parâmetros visíveis no arquivo são horizonte de 10 anos, taxa de desconto ~19,9455% e crescimento de perpetuidade de 3%.

# 13. Componentes legados e auxiliares

## 13.1 TOTAL-Old

Mantém a soma histórica das metas: Brasil + Exterior + Cripto. A célula C6 = 94,5% é referenciada por Brasil, Exterior, TOTAL e Escriturador, mas nessas abas atua principalmente como informação de “sobre/alocação total”, não como entrada do score por ativo.

## 13.2 Escriturador

É uma tabela operacional que associa ativos a instituições/escrituradores (ex.: ITAU, BRD, BTG). Também guarda notas trimestrais. Não participa do ranking atual de aporte.

## 13.3 EPR

Base de Country Risk Premium / Equity Risk Premium por país. A regra principal por linha é:

country_equity_risk_premium = mature_market_ERP + country_risk_premium

Para o Brasil, a tabela mostra ERP total de 7,47% e country risk premium de 3,24% no snapshot analisado. É um insumo de valuation, não do score de aporte diretamente.

## 13.4 2025 - Brasil

É uma versão histórica da carteira brasileira com pesos e métricas anteriores. Não deve ser usada como fonte de verdade na nova implementação, exceto se for necessário importar histórico.

# 14. Regras de borda e comportamentos que precisam ser preservados

| **Caso**                  | **Comportamento atual**                                                                                                                          |
|---------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| Sem nota média            | Multiplicador efetivo cai para 1,0 se o lookup falhar; visualmente a nota aparece como “-”.                                                      |
| Sem último aporte         | Cooldown não é aplicado.                                                                                                                         |
| Último aporte \< 45 dias  | Score zerado, salvo se a primeira condição de excesso + desconto negativo for acionada antes.                                                    |
| Score negativo            | Permanece no ranking, porém MAX(0, score) impede alocação no módulo de aportes.                                                                  |
| Soma dos top 4 scores = 0 | A divisão score/soma ficaria indefinida. A planilha não contém proteção robusta para esse cenário; o novo sistema precisa tratar explicitamente. |
| Ativo sem cotação         | Planilha tende a usar cache/IFERROR. Novo sistema deve definir política de fallback e idade máxima do preço.                                     |
| Ticker internacional      | Pode comprar quantidade fracionária.                                                                                                             |
| Ticker brasileiro         | Quantidade de compra é arredondada para baixo para inteiro.                                                                                      |
| Tesouro                   | Preço operacional fixado em 1 e quantidade equivale a valor financeiro.                                                                          |

# 15. Especificação recomendada para implementação

## 15.1 Entidades mínimas

| **Entidade**        | **Campos essenciais**                                                                                                   |
|---------------------|-------------------------------------------------------------------------------------------------------------------------|
| Asset               | ticker, name, market, currency, asset_type, target_weight, active                                                       |
| Position            | asset_id, quantity, market_value, current_weight, price_timestamp                                                       |
| Rating              | asset_id, period, score                                                                                                 |
| Valuation           | asset_id, fair_value/reference_price, discount, valuation_date, source                                                  |
| ContributionHistory | asset_id, date, amount, quantity                                                                                        |
| PortfolioSettings   | portfolio_value, contribution_amount, max_absolute_weight, max_relative_to_target, cooldown_days, top_n, FX spread, IOF |
| ScoreRatingMap      | min_rating, multiplier                                                                                                  |

## 15.2 Pseudocódigo completo do score

function calculateScore(asset, today):  
target = asset.target_weight  
current = asset.current_weight  
discount = asset.discount ?? 0  
adjustedTarget = target \* (1 + discount)  
  
if discount \< 0 and current \> target \* 1.20:  
return adjustedTarget - current  
  
if asset.type == TREASURY_SELIC:  
if current \> 0.50 or current \> target \* 1.30:  
return 0  
return max(0, adjustedTarget - current)  
  
if current \> 0.05:  
return 0  
if current \> target \* 1.30:  
return 0  
if asset.lastContributionDate != null and daysBetween(today, asset.lastContributionDate) \< 45:  
return 0  
  
multiplier = lookupRatingMultiplier(asset.averageLast4Ratings, default=1.0)  
return max(0, adjustedTarget - current) \* multiplier

## 15.3 Pseudocódigo completo do aporte

scores = all active assets from Brazil + Exterior  
scores = sortDescending(scores, by=score)  
selected = first 4 assets  
positiveScores = max(score, 0) for each selected  
sumScores = sum(positiveScores)  
  
if sumScores \<= 0:  
return no_purchase_recommendation  
  
riskBudget = contributionAmount \* effectiveRiskAllocation  
  
for asset in selected:  
share = max(asset.score, 0) / sumScores  
budget = riskBudget \* share  
  
if asset.market == BRAZIL:  
qty = floor(budget / asset.executionPriceBRL)  
else:  
qty = budget / asset.executionPriceBRL  
  
realizedBRL = qty \* asset.executionPriceBRL  
output(asset, share, qty, realizedBRL)

# 16. Parâmetros que hoje estão “escondidos” em fórmulas

| **Parâmetro**                            | **Valor atual** | **Uso**                                                 |
|------------------------------------------|-----------------|---------------------------------------------------------|
| Cooldown de aporte                       | 45 dias         | Bloqueia novo aporte em ativo comum.                    |
| Teto absoluto por ativo comum            | 5% da carteira  | Score = 0 acima desse peso.                             |
| Teto absoluto TD.Selic                   | 50% da carteira | Score = 0 acima desse peso.                             |
| Limite relativo de bloqueio              | 130% da meta    | Score = 0 acima desse nível.                            |
| Gatilho de excesso com desconto negativo | 120% da meta    | Permite score negativo para sinalizar excesso.          |
| Quantidade de notas para média           | 4               | Média das 4 notas numéricas mais recentes.              |
| Top N de aporte                          | 4 ativos        | Só os quatro maiores scores recebem orçamento.          |
| Spread cambial                           | 1,5%            | Componente do VET internacional.                        |
| IOF                                      | 0,38%           | Componente do VET internacional.                        |
| Base de risco Brasil                     | 85%             | Usada no multiplicador agregado quando mediana \<= 15%. |
| Base de risco Exterior                   | 90%             | Usada no multiplicador agregado quando mediana \<= 15%. |
| Piso/teto do ajuste regional Brasil      | 20% / 90%       | Clamp da preferência relativa Brasil vs Exterior.       |

Recomendação de arquitetura: todos esses números devem virar parâmetros nomeados e versionados. Assim, uma alteração de regra não exige editar código nem reproduzir “números mágicos” espalhados em fórmulas.

# 17. Pontos que exigem decisão antes de reproduzir 100% o comportamento

| **Ponto**                           | **Estado atual**                                                                        | **Decisão recomendada**                                                            |
|-------------------------------------|-----------------------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| Alocação dinâmica risco/renda fixa  | D16 calcula ~94,3%, mas C16 está fixado em 100% e é C16 que alimenta B19/C19.           | Escolher se o sistema deve obedecer ao cálculo dinâmico ou manter override manual. |
| Base Brasil 85% vs Exterior 90%     | As duas regiões usam bases diferentes no multiplicador de risco.                        | Confirmar se é intencional e parametrizar por região.                              |
| D34 vs D35 em valores USD           | Há fórmulas que misturam spot e VET.                                                    | Separar preço de mercado, taxa de execução e valor contábil.                       |
| Blacklist                           | Existe apenas o cabeçalho “Blacklist”; não há ativos nem fórmula consumindo essa lista. | Implementar apenas se houver regra desejada fora do arquivo atual.                 |
| \#REF! em linhas vazias/legadas     | TOTAL/Brasil contêm fórmulas antigas com \#REF! fora do bloco ativo.                    | Não migrar lixo estrutural; migrar apenas regras ativas.                           |
| TOTAL G1 com \#NUM!                 | Mediana sobre coluna que contém texto “-” no snapshot exportado.                        | No novo sistema usar null e mediana apenas sobre valores numéricos.                |
| Heurística ticker termina em número | Define Brasil vs exterior.                                                              | Trocar por atributo explícito de mercado/moeda.                                    |

# 18. Casos de teste para validar a migração

| **Cenário**                                                         | **Resultado esperado**                                                    |
|---------------------------------------------------------------------|---------------------------------------------------------------------------|
| Ativo 3% meta, 2% atual, +20% desconto, nota 10, sem aporte recente | Meta ajustada = 3,6%; gap = 1,6%; multiplicador 1,0; score = 1,6%.        |
| Mesmo ativo com nota 6                                              | Score = 1,6% × 0,70 = 1,12%.                                              |
| Ativo 3% meta, 4,1% atual, desconto positivo                        | current \> 130% da meta; score = 0.                                       |
| Ativo 3% meta, 3,7% atual, desconto -10%                            | current \> 120% da meta e desconto negativo; score = 2,7% - 3,7% = -1,0%. |
| Ativo elegível, mas último aporte há 20 dias                        | Score = 0.                                                                |
| Quatro scores 4, 3, 2, 1                                            | Frações de aporte = 40%, 30%, 20%, 10%.                                   |
| Ativo brasileiro com orçamento R\$ 1.000 e preço R\$ 33             | Quantidade = floor(1000/33)=30; realizado = R\$ 990.                      |
| Ativo exterior com orçamento R\$ 1.000 e preço efetivo R\$ 500      | Quantidade = 2,0; frações são permitidas.                                 |

# 19. Resumo executivo da regra de negócio

**Em termos de produto, o sistema atual faz o seguinte:** define uma meta por ativo; mede quanto cada posição vale dentro do patrimônio; ajusta a meta pelo valuation; reduz a prioridade de empresas com notas piores; bloqueia aportes por concentração e por recência; combina Brasil e Exterior num ranking único; seleciona os quatro maiores scores; e divide o dinheiro do aporte proporcionalmente ao score de cada um. Na execução, converte o orçamento em quantidade inteira para ativos brasileiros e permite frações no exterior, incluindo custos cambiais estimados.

**A essência matemática do motor pode ser resumida como:**

score ≈ max(0, target_weight × (1 + discount) − current_weight) × quality_multiplier, sujeito às travas de concentração e cooldown

Para reconstruir o sistema do zero, a prioridade deve ser preservar essas regras de negócio, não copiar referências de células. A planilha contém componentes históricos e algumas fórmulas inconsistentes; estes foram identificados separadamente para que a nova implementação possa reproduzir apenas o comportamento desejado, com parâmetros explícitos e testes automatizados.
