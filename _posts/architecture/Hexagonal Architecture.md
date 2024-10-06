헥사고날 아키텍처를 사용하여 Spring Security, JWT, 그리고 Kotlin으로 일반 로그인을 구현하는 예시 코드를 제공해드리겠습니다. 이 구현은 다음과 같은 구조를 가집니다:

1. Domain Layer
2. Application Layer
3. Infrastructure Layer
4. Adapters Layer

먼저 각 레이어별로 코드를 작성한 후, 전체적인 구조를 설명하겠습니다.

1. Domain Layer

```kotlin
// User.kt
data class User(
    val id: Long,
    val username: String,
    val password: String,
    val roles: List<String>
)

// UserRepository.kt
interface UserRepository {
    fun findByUsername(username: String): User?
    fun save(user: User): User
}
```

2. Application Layer

```kotlin
// UserService.kt
interface UserService {
    fun loadUserByUsername(username: String): User?
    fun createUser(user: User): User
}

// UserServiceImpl.kt
class UserServiceImpl(private val userRepository: UserRepository) : UserService {
    override fun loadUserByUsername(username: String): User? {
        return userRepository.findByUsername(username)
    }

    override fun createUser(user: User): User {
        return userRepository.save(user)
    }
}

// AuthenticationService.kt
interface AuthenticationService {
    fun authenticate(username: String, password: String): String?
}

// AuthenticationServiceImpl.kt
class AuthenticationServiceImpl(
    private val userService: UserService,
    private val passwordEncoder: PasswordEncoder,
    private val jwtTokenProvider: JwtTokenProvider
) : AuthenticationService {
    override fun authenticate(username: String, password: String): String? {
        val user = userService.loadUserByUsername(username) ?: return null
        if (passwordEncoder.matches(password, user.password)) {
            return jwtTokenProvider.createToken(username, user.roles)
        }
        return null
    }
}
```

3. Infrastructure Layer

```kotlin
// JwtTokenProvider.kt
@Component
class JwtTokenProvider(
    @Value("\${jwt.secret}") private val secretKey: String,
    @Value("\${jwt.expiration}") private val validityInMilliseconds: Long
) {
    private val key: SecretKey

    init {
        key = Keys.hmacShaKeyFor(secretKey.toByteArray())
    }

    fun createToken(username: String, roles: List<String>): String {
        val claims = Claims.empty()
        claims["roles"] = roles
        val now = Date()
        val validity = Date(now.time + validityInMilliseconds)

        return Jwts.builder()
            .setClaims(claims)
            .setSubject(username)
            .setIssuedAt(now)
            .setExpiration(validity)
            .signWith(key)
            .compact()
    }

    fun validateToken(token: String): Boolean {
        try {
            Jwts.parserBuilder().setSigningKey(key).build().parseClaimsJws(token)
            return true
        } catch (e: JwtException) {
            throw InvalidJwtAuthenticationException("Expired or invalid JWT token")
        }
    }

    fun getUsername(token: String): String {
        return Jwts.parserBuilder().setSigningKey(key).build().parseClaimsJws(token).body.subject
    }
}

// JwtConfigurer.kt
class JwtConfigurer(private val jwtTokenProvider: JwtTokenProvider) : SecurityConfigurerAdapter<DefaultSecurityFilterChain, HttpSecurity>() {
    override fun configure(builder: HttpSecurity) {
        val customFilter = JwtTokenFilter(jwtTokenProvider)
        builder.addFilterBefore(customFilter, UsernamePasswordAuthenticationFilter::class.java)
    }
}

// JwtTokenFilter.kt
class JwtTokenFilter(private val jwtTokenProvider: JwtTokenProvider) : GenericFilterBean() {
    override fun doFilter(request: ServletRequest, response: ServletResponse, chain: FilterChain) {
        val token = getTokenFromRequest(request as HttpServletRequest)
        if (token != null && jwtTokenProvider.validateToken(token)) {
            val auth = UsernamePasswordAuthenticationToken(jwtTokenProvider.getUsername(token), null, emptyList())
            SecurityContextHolder.getContext().authentication = auth
        }
        chain.doFilter(request, response)
    }

    private fun getTokenFromRequest(req: HttpServletRequest): String? {
        val bearerToken = req.getHeader("Authorization")
        return if (bearerToken != null && bearerToken.startsWith("Bearer ")) {
            bearerToken.substring(7)
        } else null
    }
}
```

4. Adapters Layer

```kotlin
// UserController.kt
@RestController
@RequestMapping("/api/users")
class UserController(private val authenticationService: AuthenticationService) {
    @PostMapping("/login")
    fun login(@RequestBody loginRequest: LoginRequest): ResponseEntity<AuthResponse> {
        val token = authenticationService.authenticate(loginRequest.username, loginRequest.password)
        return if (token != null) {
            ResponseEntity.ok(AuthResponse(token))
        } else {
            ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }
    }
}

// SecurityConfig.kt
@Configuration
@EnableWebSecurity
class SecurityConfig(
    private val jwtTokenProvider: JwtTokenProvider
) : WebSecurityConfigurerAdapter() {

    override fun configure(http: HttpSecurity) {
        http
            .httpBasic().disable()
            .csrf().disable()
            .sessionManagement().sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            .and()
            .authorizeRequests()
            .antMatchers("/api/users/login").permitAll()
            .anyRequest().authenticated()
            .and()
            .apply(JwtConfigurer(jwtTokenProvider))
    }

    @Bean
    fun passwordEncoder(): PasswordEncoder = BCryptPasswordEncoder()
}
```

이제 전체적인 구조를 설명하겠습니다:

1. Domain Layer: 핵심 비즈니스 로직과 엔티티를 포함합니다. 여기서는 User 엔티티와 UserRepository 인터페이스를 정의했습니다.

2. Application Layer: 애플리케이션의 use case를 구현합니다. UserService와 AuthenticationService 인터페이스 및 구현체가 여기에 속합니다.

3. Infrastructure Layer: 외부 라이브러리나 프레임워크와의 통합을 담당합니다. JWT 관련 클래스들(JwtTokenProvider, JwtConfigurer, JwtTokenFilter)이 이 레이어에 속합니다.

4. Adapters Layer: 외부 세계와의 통신을 담당합니다. REST 컨트롤러(UserController)와 Spring Security 설정(SecurityConfig)이 여기에 속합니다.

이 구조를 통해 각 레이어의 책임이 명확히 분리되어 있으며, 의존성 방향이 안쪽으로 향하고 있습니다. 예를 들어, Domain Layer는 다른 어떤 레이어에도 의존하지 않으며, Application Layer는 Domain Layer에만 의존합니다.

이 구현에서 로그인 프로세스는 다음과 같이 동작합니다:

1. 클라이언트가 /api/users/login 엔드포인트로 username과 password를 전송합니다.
2. UserController가 이 요청을 받아 AuthenticationService에 인증을 요청합니다.
3. AuthenticationService는 UserService를 통해 사용자 정보를 조회하고, 비밀번호를 검증합니다.
4. 인증이 성공하면 JwtTokenProvider를 사용하여 JWT 토큰을 생성합니다.
5. 생성된 토큰이 클라이언트에게 반환됩니다.

이후의 요청에서는 JwtTokenFilter가 요청 헤더에서 토큰을 추출하고 검증하여 인증을 처리합니다.

이 구조는 테스트 용이성, 유지보수성, 확장성 등의 이점을 제공하며, 비즈니스 로직을 외부 의존성으로부터 격리시켜 줍니다.