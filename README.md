# Afinador de Violão

Afinador básico para violão em React (Vite), com visual escuro em relevo e LEDs.

## Como rodar

Precisa do Node.js 18 ou mais recente.

```bash
npm install
npm run dev
```

Abra o endereço que aparecer (normalmente http://localhost:5173), toque em **MIC** e permita o acesso ao microfone.

### No celular

O navegador do celular só libera o microfone em conexão segura (HTTPS). Para testar na mesma rede Wi-Fi:

```bash
npm run dev:celular
```

Abra no celular o endereço `https://SEU-IP:5173` que aparece no terminal. O navegador vai avisar que o certificado não é confiável (ele é gerado na hora para testes); aceite para continuar.

Para publicar de verdade, rode `npm run build` e envie a pasta `dist/` para qualquer hospedagem com HTTPS (Vercel, Netlify, GitHub Pages).

## Como usar

- **MIC**: liga o microfone. Toque uma corda e o afinador mostra a nota, a diferença em cents e se você deve **apertar** (nota grave) ou **afrouxar** (nota aguda) a corda. O ponteiro e a leitura ficam verdes quando a corda está a até ±5 cents.
- **AUTO**: com ele ligado, o afinador identifica sozinho qual corda você tocou. Desligado, ou ao tocar num botão de corda com o microfone ligado, o alvo fica fixo naquela corda. Tocar de novo no mesmo botão volta ao automático.
- **Botões de corda** (com o microfone desligado): tocam a nota de referência para afinar de ouvido.
- **Botão do centro**: toca a nota de referência da corda mostrada.

Afinação padrão (Lá = 440 Hz): E2 82,41 · A2 110,00 · D3 146,83 · G3 196,00 · B3 246,94 · E4 329,63 Hz.

## Estrutura

```
src/
  App.jsx    interface e hook useTuner (microfone, análise, nota de referência)
  pitch.js   detecção de frequência (algoritmo YIN) e utilitários de cents
  App.css    visual
  main.jsx   ponto de entrada
```

A detecção usa o algoritmo YIN sobre 4096 amostras, cerca de 30 vezes por segundo, com mediana das últimas 5 leituras e suavização do ponteiro.
