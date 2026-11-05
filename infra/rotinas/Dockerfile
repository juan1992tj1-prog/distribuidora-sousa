FROM postgres:17-alpine
RUN apk add --no-cache rclone curl gnupg tzdata
COPY backup.sh restaurar.sh crontab /rotinas/
RUN chmod +x /rotinas/*.sh && crontab /rotinas/crontab
# o cron não repassa as variáveis do container para os jobs; salvamos num arquivo que os jobs carregam
CMD ["sh", "-c", "export -p > /rotinas/env.sh && exec crond -f -l 8"]
