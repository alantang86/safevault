# 使用超轻量级的 Python Alpine 基础镜像（构建后仅约 50MB）
FROM python:3.12-alpine

# 设置时区和工作目录
ENV TZ=Asia/Shanghai
WORKDIR /app

# 将后端服务与前端静态资源复制到镜像中
COPY server.py /app/
COPY web/ /app/web/

# 创建专门用于挂载持久化数据库的目录
RUN mkdir -p /app/data

# 暴露服务端口
EXPOSE 19527

# 启动原生 Web 服务
CMD ["python", "server.py"]
