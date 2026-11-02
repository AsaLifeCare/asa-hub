# asa-hub-chat — built by `docker compose --env-file ../.env build asa-hub-chat` (deploy/README.md).
# The final stage copies a marker from the test stage, so a build cannot finish without the tests passing.

FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src
COPY src/AsaHubChat/AsaHubChat.csproj src/AsaHubChat/
RUN dotnet restore src/AsaHubChat/AsaHubChat.csproj
COPY src/ src/
RUN dotnet publish src/AsaHubChat/AsaHubChat.csproj -c Release -o /out --no-restore /p:UseAppHost=false

FROM build AS test
COPY tests/ tests/
RUN dotnet test tests/AsaHubChat.Tests/AsaHubChat.Tests.csproj -c Release \
    && touch /tests-passed

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
WORKDIR /app
COPY --from=build /out .
COPY --from=test /tests-passed /app/.tests-passed
# The image listens on 8080 (ASPNETCORE_HTTP_PORTS); HOME is the tmpfs, as the container is read-only.
ENV DOTNET_EnableDiagnostics=0 \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 \
    HOME=/tmp
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "AsaHubChat.dll"]
