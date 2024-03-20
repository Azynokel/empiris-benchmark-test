package fib

func initFib(n int) int {
	result := 0

	for i := 0; i < n; i++ {
		result += i
	}

	return result
}

func Fib(n int) int {
	initFib(n)
	if n < 2 {
		return n
	}
	return Fib(n-1) + Fib(n-2) + 1
}

func Fib2(n int) int {
	if n < 2 {
		return n
	}
	return Fib(n-1) + Fib(n-2)
}
